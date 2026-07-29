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

// 0x76 on most GY-BMP280 breakouts, 0x77 on Adafruit boards.
static const uint8_t BMP_ADDR[] = {0x76, 0x77};
static const uint32_t READ_INTERVAL = 2000;
static const float SEA_LEVEL_HPA = 1013.25f;  // reference for derived altitude

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
  std::vector<const char *> menu = {"wifi", "info", "restart"};
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

// Anything past 2023 means NTP answered; the RTC starts at the epoch.
static bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  while (time(nullptr) < 1700000000 && millis() - start < 10000) {
    delay(250);
  }
  return time(nullptr) >= 1700000000;
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

void handleStationConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting");
    stopStationWebPortal();
    beginStationConnect();
    return;
  }

  // One check per boot, right after the first successful connect. Blocks the
  // loop for the NTP wait + download - fine at boot, nothing else is running.
  if (!otaCheckedThisBoot) {
    otaCheckedThisBoot = true;
    if (!syncClock()) Serial.println("NTP sync timed out, continuing");
    checkForOtaUpdate();
  }

  if (!webPortalRunning) startStationWebPortal();
  webPortal.process();

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

  // We do our own backoff; the SDK's auto-reconnect just fights it.
  WiFi.setAutoReconnect(false);

  loadWifiCredentials();
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
