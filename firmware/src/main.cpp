#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Adafruit_BMP280.h>
#include <reading.h>
#include <wifi_state.h>

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

void handleStationConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting");
    stopStationWebPortal();
    beginStationConnect();
    return;
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
