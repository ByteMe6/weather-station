#include "ota.h"

#include <Arduino.h>
#include <Ed25519.h>
#include <HTTPClient.h>
#include <SHA256.h>
#include <Update.h>
#include <WiFiClientSecure.h>
#include <ota_state.h>

#include "clock_sync.h"
#include "device_config.h"
#include "ota_pubkey.h"
#include "version.h"

// Six hours. The boot-only check meant a device that stayed up never saw a
// new firmware version at all, and with the interval now arriving in the
// manifest it would never see a cadence change either.
static const uint32_t OTA_CHECK_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL;
static uint32_t lastOtaCheck = 0;
static bool otaCheckedThisBoot = false;

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

  // Signature covers version + digest + interval so neither an old signed
  // image nor an altered cadence can be replayed under a newer version.
  uint8_t signedMsg[40];
  OtaManifest signedCopy = m;
  memcpy(signedCopy.sha256, digest, sizeof(digest));
  buildOtaSignedMessage(signedCopy, signedMsg);
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
  // parseManifest() only type-checks JSON, and installUpdate()'s verify is
  // reached only when a newer image is offered - so an interval-only
  // manifest, which is the main reason config lives here at all, would
  // otherwise be applied and persisted on no authority whatsoever. Verify
  // before acting on any field.
  //
  // This covers the manifest's claimed digest. installUpdate() verifies
  // again after downloading, over the digest it computed from the actual
  // bytes, and refuses the image unless the two match - so the claimed
  // value being signed here cannot be used to smuggle a different image.
  uint8_t manifestMsg[40];
  buildOtaSignedMessage(m, manifestMsg);
  if (!Ed25519::verify(m.sig, OTA_PUBKEY, manifestMsg, sizeof(manifestMsg))) {
    Serial.println("OTA: bad manifest signature, ignoring");
    return;
  }
  applyManifestInterval(m.intervalMs);
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

void otaTick() {
  // One check per boot, right after the first successful connect. Blocks the
  // loop for the NTP wait + download - fine at boot, nothing else is running.
  if (!otaCheckedThisBoot) {
    otaCheckedThisBoot = true;
    if (!syncClock()) Serial.println("NTP sync timed out, will retry before the first upload");
    checkForOtaUpdate();
    lastOtaCheck = millis();
  } else if (millis() - lastOtaCheck >= OTA_CHECK_INTERVAL_MS) {
    // No syncClock() here: it blocks for up to 10s and the clock is already
    // good by now. Only the first check pays that cost.
    lastOtaCheck = millis();
    checkForOtaUpdate();
  }
}
