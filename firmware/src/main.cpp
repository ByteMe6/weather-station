#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Adafruit_BMP280.h>
#include <reading.h>
#include <wifi_state.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <SHA256.h>
#include <Ed25519.h>
#include <time.h>
#include <ota_state.h>
#include "version.h"
#include "ota_pubkey.h"
#include <aggregate.h>
#include <upload.h>
#include <sys/time.h>
#include "ca_bundle.h"

// 0x76 on most GY-BMP280 breakouts, 0x77 on Adafruit boards.
static const uint8_t BMP_ADDR[] = {0x76, 0x77};
static const uint32_t READ_INTERVAL = 2000;
// current sea-level pressure (QNH) — update to local weather report when altitude drifts
static const float SEA_LEVEL_HPA = 1020.2f;

static Adafruit_BMP280 bmp;
static bool ready = false;
static uint32_t lastRead = 0;

// BOOT button on the dev board, active low. Hold 5s to wipe wifi creds.
static const uint8_t RESET_BUTTON_PIN = 0;
static const uint32_t RESET_HOLD_MS = 5000;
static const uint32_t STATION_CONNECT_TIMEOUT_MS = 15000;

// Skin for the stock WiFiManager pages, used by both portals.
static const char PORTAL_STYLE[] =
    "<style>"
    "body{background:#edeff2;color:#22262b;font-size:14px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;}"
    ".wrap{background:#fff;max-width:360px;margin:20px auto;padding:20px 18px;"
    "border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.12);}"
    "h1{font-size:16px;font-weight:600;margin:0 0 12px;}"
    // stock css gives buttons line-height:2.4rem, which is what makes them huge
    "button{background:#1a73e8;border:0;border-radius:5px;padding:8px 12px;"
    "font-size:14px;line-height:1.4;cursor:pointer;}"
    "button:hover{background:#1765cc;}"
    "button.D{background:#d93025;}"
    "input,select{border:1px solid #cdd2d9;border-radius:5px;padding:8px 10px;font-size:14px;margin:2px 0 10px;}"
    "input:focus{border-color:#1a73e8;outline:none;box-shadow:0 0 0 2px rgba(26,115,232,.25);}"
    "a{color:#1a73e8;text-decoration:none;}"
    "a:hover{text-decoration:underline;}"
    ".wrap>div>a{display:inline-block;padding:4px 0;font-size:14px;color:#22262b;}"
    ".msg{border-left:3px solid #1a73e8;background:#f2f6fd;padding:10px;border-radius:4px;}"
    ".msg.D{border-color:#d93025;background:#fdf3f2;}"
    ".msg.S{border-color:#188038;background:#f0f9f2;}"
    "</style>";

void applyPortalStyle(WiFiManager &wm) {
  wm.setTitle("Weather Station");
  wm.setCustomHeadElement(PORTAL_STYLE);
}

enum class WifiPhase {
  BOOT,
  SETUP_PORTAL,
  STATION_CONNECTING,
  STATION_CONNECTED,
};

static WifiPhase wifiPhase = WifiPhase::BOOT;
static Preferences wifiPrefs;
static String savedSsid;
static String savedPass;
static uint32_t connectAttempt = 0;
static uint32_t connectingSince = 0;
static uint32_t backoffDurationMs = 0;
static bool backingOff = false;
static uint32_t resetPressStart = 0;
static bool resetPressActive = false;
static bool otaCheckedThisBoot = false;

// Same portal, kept reachable on the LAN once we're connected.
static WiFiManager webPortal;
static bool webPortalRunning = false;

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

static bool clockValid = false;

// Where readings go. NVS wins over the flash-time API_URL so the endpoint can
// be repointed from the portal without a reflash.
static Preferences cfgPrefs;
static String apiUrl;
static WiFiManagerParameter apiUrlParam("apiurl", "Backend URL", "", 128);
static bool apiUrlParamAdded = false;

bool initSensor() {
  if (!bmp.begin(BMP_ADDR[0]) && !bmp.begin(BMP_ADDR[1])) return false;

  bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::FILTER_OFF);
  return true;
}

void loadWifiCredentials() {
  wifiPrefs.begin("wifi", true);
  savedSsid = wifiPrefs.getString("ssid", "");
  savedPass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
}

bool saveWifiCredentials(const String &ssid, const String &pass) {
  if (!wifiPrefs.begin("wifi", false)) return false;
  size_t ssidWritten = wifiPrefs.putString("ssid", ssid);
  size_t passWritten = wifiPrefs.putString("pass", pass);
  wifiPrefs.end();
  return ssidWritten == ssid.length() && passWritten == pass.length();
}

void clearWifiCredentials() {
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();
  wifiPrefs.end();
}

// https is required everywhere the URL can come from, not just the portal
// field below: the ingest path carries a signature over the device secret,
// and a plaintext endpoint would put both the signature and the reading on
// the wire in the clear. secrets.ini predates this check, so the flash-time
// API_URL fallback is the realistic way an http:// URL gets in here. Warned
// once - closeUploadWindow() calls this every 5-minute window and a repeat
// log line for a condition that can't change without a reflash or a portal
// save is just noise.
//
// ALLOW_INSECURE_API_URL relaxes this to also accept http://, for developing
// against a server on the LAN where a publicly trusted certificate is not
// practical to stand up. It is set only by the esp32dev-local build env, never
// from secrets.ini: that file is per-device and gets copied between them, so a
// flag living there would eventually reach a device shipping real readings.
// Choosing a different build target is a deliberate act; copying a config file
// is not.
static bool apiUrlWarned = false;

static bool apiUrlSchemeAllowed() {
  if (apiUrl.startsWith("https://")) return true;
#ifdef ALLOW_INSECURE_API_URL
  if (apiUrl.startsWith("http://")) return true;
#endif
  return false;
}

static bool checkApiUrlScheme() {
  if (apiUrlSchemeAllowed()) return true;
  if (!apiUrlWarned) {
    apiUrlWarned = true;
    Serial.printf("Backend URL is not https, uploads disabled: %s\n", apiUrl.c_str());
  }
  return false;
}

void loadApiUrl() {
  cfgPrefs.begin("cfg", true);
  apiUrl = cfgPrefs.getString("apiurl", "");
  cfgPrefs.end();
  if (apiUrl.length() == 0) apiUrl = API_URL;
#ifdef ALLOW_INSECURE_API_URL
  // Loud on every boot, not warn-once: this build will happily put a signed
  // reading on the wire in plaintext, and the log is the only place that says
  // so. If this line shows up on a device that is meant to be in the field,
  // it was built from the wrong target.
  Serial.println("*** ALLOW_INSECURE_API_URL build - http:// backends accepted, DEV ONLY ***");
#endif
  checkApiUrlScheme();
}

bool saveApiUrl(const String &url) {
  if (!cfgPrefs.begin("cfg", false)) return false;
  size_t written = cfgPrefs.putString("apiurl", url);
  cfgPrefs.end();
  return written == url.length();
}

// Portal callback for the Backend URL field. https is required: the ingest
// path carries a signature over the device secret and must never fall back to
// plaintext, so a http:// entry is refused rather than quietly accepted -
// unless this is an ALLOW_INSECURE_API_URL dev build, which accepts both.
// The check is deliberately the same predicate the upload path uses, so the
// portal can never store a URL that closeUploadWindow() would then refuse.
void syncApiUrlFromPortal() {
  String url = apiUrlParam.getValue();
  url.trim();
  if (url.length() == 0) return;

  const String saved = apiUrl;
  apiUrl = url;
  const bool accepted = apiUrlSchemeAllowed();
  apiUrl = saved;

  if (!accepted) {
#ifdef ALLOW_INSECURE_API_URL
    Serial.println("Backend URL rejected: must start with https:// or http://");
#else
    Serial.println("Backend URL rejected: must start with https://");
#endif
    // WiFiManager's save-params page always shows "Saved" no matter what this
    // callback does, so an operator who enters http:// sees success with no
    // visible sign it was rejected unless they're watching serial. Put the
    // field back to what's actually in effect so revisiting the page doesn't
    // keep showing the rejected value as if it had taken.
    apiUrlParam.setValue(apiUrl.c_str(), 128);
    return;
  }
  if (saveApiUrl(url)) {
    apiUrl = url;
    Serial.printf("Backend URL updated: %s\n", apiUrl.c_str());
  } else {
    Serial.println("Failed to save backend URL to NVS");
  }
}

void startSetupPortal() {
  Serial.println("No saved WiFi - starting setup portal");
  wifiPhase = WifiPhase::SETUP_PORTAL;

  String apName = String("WeatherStation-") + DEVICE_ID;

  bool credentialsSaved = false;
  while (!credentialsSaved) {
    WiFiManager wm;
    applyPortalStyle(wm);
    bool connected = wm.startConfigPortal(apName.c_str());
    if (!connected) {
      Serial.println("Setup portal closed without a connection, reopening");
      continue;
    }

    // WiFi.SSID() comes back empty if the AP dropped right after joining.
    // Saving that would leave us retrying an empty ssid until reboot.
    String ssid = WiFi.SSID();
    String pass = WiFi.psk();
    if (ssid.length() == 0) {
      Serial.println("Joined network dropped before credentials could be read, reopening portal");
      continue;
    }

    if (saveWifiCredentials(ssid, pass)) {
      savedSsid = ssid;
      savedPass = pass;
      credentialsSaved = true;
    } else {
      Serial.println("Failed to save WiFi credentials to NVS, reopening portal");
    }
  }

  connectAttempt = 0;
  wifiPhase = WifiPhase::STATION_CONNECTED;
  Serial.println("WiFi credentials saved, connected");
}

void syncCredentialsFromWebPortal() {
  // Don't overwrite good creds with an empty ssid (same race as the setup portal).
  String ssid = WiFi.SSID();
  String pass = WiFi.psk();
  if (ssid.length() == 0) return;

  if (saveWifiCredentials(ssid, pass)) {
    savedSsid = ssid;
    savedPass = pass;
    Serial.printf("WiFi credentials updated via web portal: %s\n", ssid.c_str());
    // New network, new IP.
    Serial.printf("Web portal: http://%s/\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("Failed to save updated WiFi credentials to NVS");
  }
}

void startStationWebPortal() {
  applyPortalStyle(webPortal);
  webPortal.setSaveConfigCallback(syncCredentialsFromWebPortal);
  // No captive redirect on the LAN, and cap the connect wait inside process()
  // so a wifi change from the portal can't stall the loop for a minute.
  // A failed change knocks wifi out for a few seconds; the drop handler
  // rejoins the old network.
  webPortal.setCaptivePortalEnable(false);
  webPortal.setSaveConnectTimeout(15);
  apiUrlParam.setValue(apiUrl.c_str(), 128);
  if (!apiUrlParamAdded) {
    webPortal.addParameter(&apiUrlParam);
    apiUrlParamAdded = true;
  }
  webPortal.setSaveParamsCallback(syncApiUrlFromPortal);
  std::vector<const char *> menu = {"wifi", "param", "info", "restart"};
  webPortal.setMenu(menu);
  webPortal.startWebPortal();
  webPortalRunning = true;
  Serial.printf("Web portal: http://%s/\n", WiFi.localIP().toString().c_str());
}

void stopStationWebPortal() {
  if (!webPortalRunning) return;
  webPortal.stopWebPortal();
  webPortalRunning = false;
}

// The handful of reasons that actually discriminate the failure modes seen
// here; anything else prints its bare number (full list: wifi_err_reason_t in
// esp_wifi_types.h).
static const char *wifiDisconnectReason(uint8_t reason) {
  switch (reason) {
    // 1/3/8 are the ordinary ways a link ends - a clean deassociation on
    // reboot reports 8, so leaving them unmapped made routine shutdowns read
    // as anomalies in the log.
    case WIFI_REASON_UNSPECIFIED:            return "unspecified";
    case WIFI_REASON_AUTH_LEAVE:             return "AP deauthenticated us";
    case WIFI_REASON_ASSOC_LEAVE:            return "left the AP (normal on reboot)";
    case WIFI_REASON_AUTH_EXPIRE:            return "auth expired";
    case WIFI_REASON_ASSOC_EXPIRE:           return "association expired";
    case WIFI_REASON_ASSOC_TOOMANY:          return "AP refused - too many clients";
    case WIFI_REASON_NOT_AUTHED:             return "not authenticated";
    case WIFI_REASON_NOT_ASSOCED:            return "not associated";
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT: return "4-way handshake timeout - wrong password";
    case WIFI_REASON_BEACON_TIMEOUT:         return "beacon timeout - out of range";
    case WIFI_REASON_NO_AP_FOUND:            return "AP not found";
    case WIFI_REASON_AUTH_FAIL:              return "auth failed";
    case WIFI_REASON_ASSOC_FAIL:             return "association refused by the AP";
    case WIFI_REASON_HANDSHAKE_TIMEOUT:      return "handshake timeout";
    case WIFI_REASON_CONNECTION_FAIL:        return "connection failed";
    default:                                 return "unmapped";
  }
}

// Both join paths swallow the ESP-IDF disconnect reason: WiFiManager reports
// only "Connect to new AP Failed", and handleStationConnecting() sees nothing
// but a WL_CONNECTED that never arrives. That cannot tell a wrong password
// apart from an AP that refuses association outright (a guest network gating
// on MAC registration, say), which are opposite problems with opposite fixes.
// The reason code is the one signal that separates them.
//
// GOT_IP is logged alongside it because association succeeding and DHCP
// succeeding are distinct steps, and a captive/gated network commonly passes
// the first and withholds the second - which looks identical from
// WiFi.status() alone.
//
// Registered once in setup() before any WiFi call, so it covers the setup
// portal, the station retry loop, and portal-driven network changes alike.
// Diagnostics only: nothing here changes connection behaviour.
static void onWifiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      uint8_t reason = info.wifi_sta_disconnected.reason;
      Serial.printf("WiFi disconnected: reason=%u (%s)\n", reason,
                    wifiDisconnectReason(reason));
      break;
    }
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("WiFi associated, waiting for DHCP");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("WiFi got IP: %s\n",
                    IPAddress(info.got_ip.ip_info.ip.addr).toString().c_str());
      break;
    default:
      break;
  }
}

void beginStationConnect() {
  stopStationWebPortal();
  Serial.printf("Connecting to %s (attempt %u)\n", savedSsid.c_str(), connectAttempt + 1);
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());
  connectingSince = millis();
  backingOff = false;
  wifiPhase = WifiPhase::STATION_CONNECTING;
}

void handleStationConnecting() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    connectAttempt = 0;
    wifiPhase = WifiPhase::STATION_CONNECTED;
    return;
  }

  if (backingOff) {
    if (millis() - connectingSince >= backoffDurationMs) {
      beginStationConnect();
    }
    return;
  }

  if (millis() - connectingSince >= STATION_CONNECT_TIMEOUT_MS) {
    connectAttempt++;
    backoffDurationMs = nextBackoffMs(connectAttempt);
    Serial.printf("Connect attempt failed, retrying in %u ms\n", backoffDurationMs);
    WiFi.disconnect();
    connectingSince = millis();
    backingOff = true;
  }
}

// Forward declaration: pollResetButton() is defined near the bottom of the
// file (with the rest of the reset-button logic) but syncClock() needs to
// call back into it below.
void pollResetButton();

// Anything past 2023 means NTP answered; the RTC starts at the epoch.
static const time_t CLOCK_SYNCED_EPOCH = 1700000000;

static bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  // loop()'s own pollResetButton() call has already returned by the time
  // control reaches here (it runs before the wifiPhase switch, and syncClock()
  // is only ever reached from inside that switch), so this is a second poll
  // within the same iteration, not a reentrant call into one that's still on
  // the stack. It shrinks this function's up-to-10s blind window down to the
  // 250ms delay granularity, so a tap-and-release that happens entirely
  // inside the wait is not lost. pollResetButton() only touches the "wifi"
  // NVS namespace and, on a full hold, restarts - neither can call back into
  // syncClock(), so there is no recursion to worry about.
  while (time(nullptr) < CLOCK_SYNCED_EPOCH && millis() - start < 10000) {
    pollResetButton();
    delay(250);
  }
  return time(nullptr) >= CLOCK_SYNCED_EPOCH;
}

// Uploads depend on a valid clock for both the payload timestamp and TLS
// certificate validity, and syncClock() is allowed to time out at boot - so a
// device that came up before its router had internet has to recover somehow.
//
// It recovers on its own: configTime() ran at boot, and lwIP's SNTP client
// keeps retrying in the background after a failed request - 15s, doubling to a
// 150s ceiling (SNTP_RETRY_TIMEOUT/_MAX/_EXP in sntp_opts.h). That is more
// often than windows close, so this only has to observe the result. Calling
// the blocking syncClock() again here would stall loop() - and therefore the
// web portal and the sensor cadence - for up to 10s every window, and would
// also restart configTime() and throw away the backoff SNTP had built up.
static bool ensureClock() {
  if (clockValid) return true;
  clockValid = time(nullptr) >= CLOCK_SYNCED_EPOCH;
  return clockValid;
}

static bool installUpdate(const OtaManifest &m) {
  WiFiClientSecure client;
  client.setInsecure();  // authenticity comes from the image signature, not TLS
  HTTPClient http;
  String url = String(OTA_BASE_URL) + "/" + m.path;
  if (!http.begin(client, url)) return false;
  if (http.GET() != HTTP_CODE_OK) {
    http.end();
    Serial.println("OTA: image fetch failed");
    return false;
  }
  // Chunked responses have no length and would hash the chunk framing;
  // Supabase always sends Content-Length, so demand one that matches.
  if (http.getSize() <= 0 || (uint32_t)http.getSize() != m.size) {
    http.end();
    Serial.println("OTA: size mismatch");
    return false;
  }

  if (!Update.begin(m.size)) {
    http.end();
    Serial.printf("OTA: cannot start update: %s\n", Update.errorString());
    return false;
  }

  SHA256 sha;
  uint8_t buf[1024];
  WiFiClient *stream = http.getStreamPtr();
  uint32_t written = 0;
  uint32_t lastData = millis();
  // Absolute cap on top of the progress timeout so a byte-trickling
  // server can't wedge the device indefinitely.
  uint32_t downloadStart = millis();
  while (written < m.size && millis() - lastData < 15000 &&
         millis() - downloadStart < 600000) {
    size_t avail = stream->available();
    if (avail == 0) {
      if (!client.connected()) break;
      delay(10);
      continue;
    }
    size_t want = avail < sizeof(buf) ? avail : sizeof(buf);
    // Never read past the image length - trailing bytes would trip Update.write.
    if (want > m.size - written) want = m.size - written;
    size_t n = stream->readBytes(buf, want);
    if (n == 0) continue;
    sha.update(buf, n);
    if (Update.write(buf, n) != n) break;
    written += n;
    lastData = millis();
  }
  http.end();

  if (written != m.size) {
    Update.abort();
    Serial.printf("OTA: download incomplete (%u/%u bytes)\n", written, m.size);
    return false;
  }

  uint8_t digest[32];
  sha.finalize(digest, sizeof(digest));
  if (memcmp(digest, m.sha256, sizeof(digest)) != 0) {
    Update.abort();
    Serial.println("OTA: digest mismatch, image rejected");
    return false;
  }

  // Signature covers version + digest so an old signed image can't be
  // replayed under a newer version number.
  uint8_t signedMsg[36];
  signedMsg[0] = (uint8_t)m.version;
  signedMsg[1] = (uint8_t)(m.version >> 8);
  signedMsg[2] = (uint8_t)(m.version >> 16);
  signedMsg[3] = (uint8_t)(m.version >> 24);
  memcpy(signedMsg + 4, digest, sizeof(digest));
  if (!Ed25519::verify(m.sig, OTA_PUBKEY, signedMsg, sizeof(signedMsg))) {
    Update.abort();
    Serial.println("OTA: bad signature, image rejected");
    return false;
  }

  // Only now does the boot partition switch.
  if (!Update.end()) {
    Serial.printf("OTA: finalize failed: %s\n", Update.errorString());
    return false;
  }
  Serial.printf("OTA: v%u installed, rebooting\n", m.version);
  ESP.restart();
  return true;  // unreachable
}

static void checkForOtaUpdate() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, OTA_BASE_URL "/manifest.json")) return;
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    Serial.printf("OTA: manifest fetch failed (%d)\n", code);
    return;
  }
  // A real manifest is a few hundred bytes; anything big or chunked is wrong.
  int len = http.getSize();
  if (len <= 0 || len > 4096) {
    http.end();
    Serial.println("OTA: manifest rejected");
    return;
  }
  String body = http.getString();
  http.end();

  OtaManifest m;
  if (!parseManifest(body.c_str(), m)) {
    Serial.println("OTA: manifest rejected");
    return;
  }
  if (!isNewerVersion(FW_VERSION, m.version)) {
    Serial.printf("OTA: up to date (v%u published, v%u running)\n", m.version, (uint32_t)FW_VERSION);
    return;
  }
  Serial.printf("OTA: v%u available, downloading %s\n", m.version, m.path);
  // Drop the manifest connection before opening the image one - two TLS
  // sessions don't fit comfortably in the heap.
  client.stop();
  installUpdate(m);
}

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

// Closes the sampling window: takes the mean, stamps it, builds and signs the
// body. The signed tuple is kept for the retries so every attempt sends an
// identical request - the server dedups on (device_id, timestamp), so a retry
// that actually did arrive the first time is a harmless no-op.
static void closeUploadWindow() {
  windowStart = millis();

  float meanTemperature = 0.0f;
  float meanPressure = 0.0f;
  bool haveMean = accumulatorMean(windowSamples, meanTemperature, meanPressure);
  accumulatorReset(windowSamples);

  if (!haveMean) {
    Serial.println("Window closed with no valid samples, nothing to upload");
    return;
  }
  // Checked before the (potentially blocking, up to 10s) clock sync: no point
  // waiting on NTP for a reading that can't be sent anyway.
  if (!checkApiUrlScheme()) return;
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
  if (buildReadingBody(iso, meanTemperature, meanPressure, pendingBody,
                       sizeof(pendingBody)) == 0) {
    Serial.println("Could not build the payload, dropping the reading");
    return;
  }
  if (!signPayload(DEVICE_SECRET, pendingTimestampMs, pendingBody,
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
  if (apiUrl.startsWith("https://")) {
    secureClient.setCACert(UPLOAD_CA_BUNDLE_PEM);
    client = &secureClient;
  } else {
    client = &plainClient;
  }

  HTTPClient http;
  http.setTimeout(UPLOAD_TIMEOUT_MS);

  // lastAttemptAt is stamped on the way out, not on the way in: it feeds the
  // retry back-off in handleStationConnected(), which measures the gap since
  // the last attempt *finished*. UPLOAD_TIMEOUT_MS (15s) is bigger than the
  // first retry delay (10s), so a request that fails slowly - a congested
  // backend timing out near the connect/response deadline instead of an
  // instant handshake rejection - would already have "used up" the 10s
  // back-off by the time control returned here, and the next attempt would
  // fire immediately with no spacing at all. Every exit path below sets this
  // right before it returns, including the http.begin() failure, so none of
  // them can leave it stale.
  if (!http.begin(*client, apiUrl)) {
    lastAttemptAt = millis();
    scheduleRetryOrDrop("cannot open the connection");
    return;
  }
  http.addHeader("content-type", "application/json");
  http.addHeader("x-device-id", DEVICE_ID);
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
      dropPendingUpload("401 - check DEVICE_SECRET and the clock");
    } else {
      dropPendingUpload("rejected by the server, retrying cannot help");
    }
    return;
  }
  scheduleRetryOrDrop("transient failure");
}

void handleStationConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting");
    if (uploadPending) dropPendingUpload("wifi lost mid-upload");
    accumulatorReset(windowSamples);
    uploadWindowStarted = false;
    stopStationWebPortal();
    beginStationConnect();
    return;
  }

  // One check per boot, right after the first successful connect. Blocks the
  // loop for the NTP wait + download - fine at boot, nothing else is running.
  if (!otaCheckedThisBoot) {
    otaCheckedThisBoot = true;
    clockValid = syncClock();
    if (!clockValid) Serial.println("NTP sync timed out, will retry before the first upload");
    checkForOtaUpdate();
  }

  if (!webPortalRunning) startStationWebPortal();
  webPortal.process();

  if (!uploadWindowStarted) {
    uploadWindowStarted = true;
    windowStart = millis();
    accumulatorReset(windowSamples);
    Serial.printf("Uploading to %s every %u ms\n", apiUrl.c_str(),
                  (uint32_t)SEND_INTERVAL_MS);
  }

  if (millis() - windowStart >= (uint32_t)SEND_INTERVAL_MS) closeUploadWindow();

  if (uploadPending &&
      (uploadAttempt == 0 || millis() - lastAttemptAt >= retryDelayMs)) {
    attemptUpload();
  }

  if (millis() - lastRead < READ_INTERVAL) return;
  lastRead = millis();

  if (!ready) {
    ready = initSensor();
    if (!ready) {
      Serial.println("BMP280 unavailable");
      return;
    }
  }

  bmp.takeForcedMeasurement();

  float t = bmp.readTemperature();
  float p = bmp.readPressure() / 100.0f;

  if (!isPlausibleReading(t, p)) {
    Serial.println("BMP280 reading out of range, re-initialising");
    ready = false;
    return;
  }

  float alt = 44330.0f * (1.0f - powf(p / SEA_LEVEL_HPA, 0.1903f));

  accumulatorAdd(windowSamples, t, p);

  Serial.printf("temp=%.2f C  pressure=%.1f hPa  altitude=%.1f m\n", t, p, alt);
}

void pollResetButton() {
  bool pressed = digitalRead(RESET_BUTTON_PIN) == LOW;

  if (!pressed) {
    resetPressActive = false;
    return;
  }

  if (!resetPressActive) {
    resetPressActive = true;
    resetPressStart = millis();
    return;
  }

  if (isResetHeld(resetPressStart, millis(), RESET_HOLD_MS)) {
    Serial.println("Reset button held 5s, wiping WiFi credentials");
    clearWifiCredentials();
    // GPIO0 is a strap pin - restarting while it's held would land in the
    // ROM bootloader, so wait for release first.
    Serial.println("Release the button to restart");
    while (digitalRead(RESET_BUTTON_PIN) == LOW) {
      delay(10);
    }
    ESP.restart();
  }
}

void setup() {
  Serial.begin(115200);
  Serial.printf("Weather Station fw v%u\n", (uint32_t)FW_VERSION);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);

  ready = initSensor();
  if (!ready) Serial.println("BMP280 not found, retrying...");

  // Before any other WiFi call so no early association/disconnect is missed.
  WiFi.onEvent(onWifiEvent);

  // We do our own backoff; the SDK's auto-reconnect just fights it.
  WiFi.setAutoReconnect(false);

  loadWifiCredentials();
  loadApiUrl();
  Serial.printf("Backend URL: %s\n", apiUrl.c_str());
  if (savedSsid.length() == 0) {
    startSetupPortal();
  } else {
    beginStationConnect();
  }
}

void loop() {
  pollResetButton();

  switch (wifiPhase) {
    case WifiPhase::STATION_CONNECTING:
      handleStationConnecting();
      break;
    case WifiPhase::STATION_CONNECTED:
      handleStationConnected();
      break;
    case WifiPhase::SETUP_PORTAL:
    case WifiPhase::BOOT:
      break;
  }
}
