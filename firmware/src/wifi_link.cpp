#include "wifi_link.h"

#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <wifi_state.h>

#include "device_config.h"
#include "portal.h"

// BOOT button on the dev board, active low. Hold 5s to wipe wifi creds.
static const uint8_t RESET_BUTTON_PIN = 0;
static const uint32_t RESET_HOLD_MS = 5000;
static const uint32_t STATION_CONNECT_TIMEOUT_MS = 15000;

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

static void loadWifiCredentials() {
  wifiPrefs.begin("wifi", true);
  savedSsid = wifiPrefs.getString("ssid", "");
  savedPass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
}

static bool saveWifiCredentials(const String &ssid, const String &pass) {
  if (!wifiPrefs.begin("wifi", false)) return false;
  size_t ssidWritten = wifiPrefs.putString("ssid", ssid);
  size_t passWritten = wifiPrefs.putString("pass", pass);
  wifiPrefs.end();
  return ssidWritten == ssid.length() && passWritten == pass.length();
}

bool adoptWifiCredentials(const String &ssid, const String &pass) {
  if (!saveWifiCredentials(ssid, pass)) return false;
  savedSsid = ssid;
  savedPass = pass;
  return true;
}

void clearWifiCredentials() {
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();
  wifiPrefs.end();
}

WifiPhase wifiCurrentPhase() { return wifiPhase; }

bool hasSavedWifiCredentials() { return savedSsid.length() > 0; }

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
// Registered once in wifiBegin() before any WiFi call, so it covers the setup
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

void wifiBegin() {
  // Before any other WiFi call so no early association/disconnect is missed.
  WiFi.onEvent(onWifiEvent);

  // We do our own backoff; the SDK's auto-reconnect just fights it.
  WiFi.setAutoReconnect(false);

  loadWifiCredentials();
}

void startSetupPortal() {
  Serial.println("No saved WiFi - starting setup portal");
  wifiPhase = WifiPhase::SETUP_PORTAL;

  // An unprovisioned device has no id to put in the SSID, but it does have a
  // MAC - and several unprovisioned boards on a bench would otherwise raise
  // identically named APs with no way to tell which one you are configuring.
  // Last two MAC bytes are enough to disambiguate a benchful.
  //
  // "unprov" rather than "unprovisioned" because the SSID limit is 32 bytes:
  // the spelled-out form plus the suffix is 33.
  String apName;
  if (configDeviceId().length()) {
    apName = String("WeatherStation-") + configDeviceId();
  } else {
    String mac = WiFi.macAddress();
    mac.replace(":", "");
    mac.toLowerCase();
    apName = String("WeatherStation-unprov-") + mac.substring(8);
  }

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

    if (adoptWifiCredentials(ssid, pass)) {
      credentialsSaved = true;
    } else {
      Serial.println("Failed to save WiFi credentials to NVS, reopening portal");
    }
  }

  connectAttempt = 0;
  wifiPhase = WifiPhase::STATION_CONNECTED;
  Serial.println("WiFi credentials saved, connected");
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

void resetButtonBegin() { pinMode(RESET_BUTTON_PIN, INPUT_PULLUP); }

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
