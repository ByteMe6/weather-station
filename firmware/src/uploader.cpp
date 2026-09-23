#include "uploader.h"

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <sys/time.h>
#include <aggregate.h>
#include <upload.h>

#include "ca_bundle.h"
#include "clock_sync.h"
#include "device_config.h"
#include "wifi_link.h"

// Three deliveries per reading in total - the first POST plus two retries -
// then it is dropped. No buffering: PRD OQ2 chose dropping over a queue that
// would grow unbounded during a long outage.
static const uint32_t UPLOAD_MAX_ATTEMPTS = 3;
static const uint32_t UPLOAD_RETRY_DELAYS_MS[] = {10000, 30000};
static const uint16_t UPLOAD_TIMEOUT_MS = 15000;
// Only used for a log line, so a couple hundred bytes is plenty - see
// readBoundedErrorBody() for why this can't just be http.getString().
static const size_t UPLOAD_RESPONSE_LOG_CAP = 256;

static SampleAccumulator windowSamples;
static bool uploadWindowStarted = false;
static uint32_t windowStart = 0;

static bool uploadPending = false;
static uint32_t uploadAttempt = 0;
static uint32_t lastAttemptAt = 0;
static uint32_t retryDelayMs = 0;
static char pendingBody[256];
static char pendingTimestampMs[24];
static char pendingSignature[65];

static void dropPendingUpload(const char *reason) {
  Serial.printf("Reading dropped: %s\n", reason);
  uploadPending = false;
  uploadAttempt = 0;
}

static void scheduleRetryOrDrop(const char *reason) {
  if (uploadAttempt >= UPLOAD_MAX_ATTEMPTS) {
    dropPendingUpload(reason);
    return;
  }
  retryDelayMs = UPLOAD_RETRY_DELAYS_MS[uploadAttempt - 1];
  Serial.printf("Upload failed (%s), attempt %u of %u in %u ms\n", reason,
                uploadAttempt + 1, UPLOAD_MAX_ATTEMPTS, retryDelayMs);
}

void uploaderAddSample(const SensorSample &sample) {
  accumulatorAdd(windowSamples, sample.temperature,
                 sample.hasHumidity ? &sample.humidity : NULL, sample.pressure);
}

void uploaderReset(const char *dropReason) {
  if (uploadPending) dropPendingUpload(dropReason);
  accumulatorReset(windowSamples);
  uploadWindowStarted = false;
}

// Closes the sampling window: takes the mean, stamps it, builds and signs the
// body. The signed tuple is kept for the retries so every attempt sends an
// identical request - the server dedups on (device_id, timestamp), so a retry
// that actually did arrive the first time is a harmless no-op.
static void closeUploadWindow() {
  windowStart = millis();

  float meanTemperature = 0.0f;
  float meanHumidity = 0.0f;
  float meanPressure = 0.0f;
  bool hasHumidity = false;
  bool haveMean = accumulatorMean(windowSamples, meanTemperature, meanHumidity,
                                  hasHumidity, meanPressure);
  accumulatorReset(windowSamples);

  if (!haveMean) {
    Serial.println("Window closed with no valid samples, nothing to upload");
    return;
  }
  // Checked before the (potentially blocking, up to 10s) clock sync: no point
  // waiting on NTP for a reading that can't be sent anyway.
  if (!checkApiUrlScheme()) return;
  if (!checkIdentity()) return;
  if (!ensureClock()) {
    Serial.println("Window closed before the clock synced, dropping the reading");
    return;
  }
  if (uploadPending) {
    dropPendingUpload("superseded by a newer reading");
  }

  struct timeval now;
  gettimeofday(&now, NULL);
  int64_t epochMs = (int64_t)now.tv_sec * 1000 + now.tv_usec / 1000;
  snprintf(pendingTimestampMs, sizeof(pendingTimestampMs), "%lld", (long long)epochMs);

  char iso[24];
  if (!formatIso8601Utc(now.tv_sec, iso, sizeof(iso))) {
    Serial.println("Could not format the timestamp, dropping the reading");
    return;
  }
  if (buildReadingBody(iso, meanTemperature, hasHumidity ? &meanHumidity : NULL,
                       meanPressure, pendingBody, sizeof(pendingBody)) == 0) {
    Serial.println("Could not build the payload, dropping the reading");
    return;
  }
  if (!signPayload(configDeviceSecret().c_str(), pendingTimestampMs, pendingBody,
                   pendingSignature, sizeof(pendingSignature))) {
    Serial.println("Could not sign the payload, dropping the reading");
    return;
  }

  uploadPending = true;
  uploadAttempt = 0;
  retryDelayMs = 0;
  Serial.printf("Reading ready: %s\n", pendingBody);
}

// http.getString() has no cap: when the server sends a non-2xx body without a
// Content-Length (chunked - common for a CDN or reverse-proxy error page),
// StreamString grows to fit the whole thing, bounded only by free heap. A
// typo'd API_URL that resolves to some generic 404 HTML page would hit this
// every 5 minutes forever. checkForOtaUpdate() caps the manifest fetch the
// same way, for the same reason - this body is only ever used for a log line,
// so a few hundred bytes is plenty.
static String readBoundedErrorBody(HTTPClient &http) {
  int len = http.getSize();
  if (len >= 0 && (size_t)len <= UPLOAD_RESPONSE_LOG_CAP) return http.getString();

  char buf[UPLOAD_RESPONSE_LOG_CAP + 1];
  WiFiClient *stream = http.getStreamPtr();
  size_t got = 0;
  uint32_t start = millis();
  while (stream != nullptr && got < UPLOAD_RESPONSE_LOG_CAP &&
         millis() - start < UPLOAD_TIMEOUT_MS) {
    size_t avail = stream->available();
    if (avail == 0) {
      if (!http.connected()) break;
      // Small and bounded, but it's still our own wait loop - poll it like
      // the one in syncClock() so a button tap-and-release during a chunked
      // error response isn't lost either.
      pollResetButton();
      delay(10);
      continue;
    }
    size_t want = avail < (UPLOAD_RESPONSE_LOG_CAP - got) ? avail : (UPLOAD_RESPONSE_LOG_CAP - got);
    size_t n = stream->readBytes(buf + got, want);
    if (n == 0) break;
    got += n;
  }
  buf[got] = '\0';
  // Only claim truncation if the cap is actually what stopped us - a chunked
  // body that happened to be shorter than the cap was read in full.
  return got >= UPLOAD_RESPONSE_LOG_CAP ? String(buf) + " (truncated)" : String(buf);
}

static void attemptUpload() {
  uploadAttempt++;

  // Both clients are declared here so whichever one is used outlives the
  // HTTPClient below - it keeps a reference, not a copy. Picking the transport
  // from the URL rather than always using the TLS client matters: HTTPClient
  // given a WiFiClientSecure and an http:// URL still attempts a handshake, on
  // port 80, against a server that is not speaking TLS. That fails in a way
  // that looks like a network fault rather than a configuration mistake.
  //
  // checkApiUrlScheme() has already run by the time a reading is pending, so a
  // plaintext URL can only reach this point in an ALLOW_INSECURE_API_URL
  // build; in a production build the else-branch is unreachable.
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  WiFiClient *client;
  if (configApiUrl().startsWith("https://")) {
    secureClient.setCACert(UPLOAD_CA_BUNDLE_PEM);
    client = &secureClient;
  } else {
    client = &plainClient;
  }

  HTTPClient http;
  http.setTimeout(UPLOAD_TIMEOUT_MS);

  // lastAttemptAt is stamped on the way out, not on the way in: it feeds the
  // retry back-off in uploaderTick(), which measures the gap since the last
  // attempt *finished*. UPLOAD_TIMEOUT_MS (15s) is bigger than the first retry
  // delay (10s), so a request that fails slowly - a congested backend timing
  // out near the connect/response deadline instead of an instant handshake
  // rejection - would already have "used up" the 10s back-off by the time
  // control returned here, and the next attempt would fire immediately with no
  // spacing at all. Every exit path below sets this right before it returns,
  // including the http.begin() failure, so none of them can leave it stale.
  if (!http.begin(*client, configApiUrl())) {
    lastAttemptAt = millis();
    scheduleRetryOrDrop("cannot open the connection");
    return;
  }
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-id", configDeviceId().c_str());
  http.addHeader("x-timestamp", pendingTimestampMs);
  http.addHeader("x-signature", pendingSignature);

  int code = http.POST((uint8_t *)pendingBody, strlen(pendingBody));

  if (code >= 200 && code < 300) {
    http.end();
    lastAttemptAt = millis();
    Serial.printf("Reading uploaded (%d)\n", code);
    uploadPending = false;
    uploadAttempt = 0;
    return;
  }

  // readBoundedErrorBody() can itself block (draining a slow or chunked error
  // body up to UPLOAD_TIMEOUT_MS), so the stamp goes after it and after
  // http.end(), not before - otherwise this path would have the exact same
  // back-off-collapse bug the comment above describes.
  String response = code > 0 ? readBoundedErrorBody(http) : http.errorToString(code);
  http.end();
  lastAttemptAt = millis();
  Serial.printf("Upload attempt %u returned %d: %s\n", uploadAttempt, code,
                response.c_str());

  if (!shouldRetryUpload(code)) {
    if (code == 401) {
      dropPendingUpload("401 - NVS identity may not match the devices row, or the clock is off");
    } else {
      dropPendingUpload("rejected by the server, retrying cannot help");
    }
    return;
  }
  scheduleRetryOrDrop("transient failure");
}

void uploaderTick() {
  if (!uploadWindowStarted) {
    uploadWindowStarted = true;
    windowStart = millis();
    accumulatorReset(windowSamples);
    Serial.printf("Uploading to %s every %u ms\n", configApiUrl().c_str(),
                  configUploadIntervalMs());
  }

  if (millis() - windowStart >= configUploadIntervalMs()) closeUploadWindow();

  if (uploadPending &&
      (uploadAttempt == 0 || millis() - lastAttemptAt >= retryDelayMs)) {
    attemptUpload();
  }
}
