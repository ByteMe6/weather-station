#pragma once

#include <Arduino.h>

// The station link and the phase machine loop() dispatches on: stored
// credentials, the connect/back-off cycle, the provisioning portal that runs
// when there are none, and the reset button that wipes them.
enum class WifiPhase {
  BOOT,
  SETUP_PORTAL,
  STATION_CONNECTING,
  STATION_CONNECTED,
};

// Event hook, auto-reconnect off, credentials loaded. Call before any other
// WiFi work so no early association or disconnect is missed.
void wifiBegin();

WifiPhase wifiCurrentPhase();
bool hasSavedWifiCredentials();

// Blocks until credentials have been entered and saved, then reports the
// station connected.
void startSetupPortal();

void beginStationConnect();
void handleStationConnecting();

// Persists the pair and adopts it as the credentials to reconnect with.
bool adoptWifiCredentials(const String &ssid, const String &pass);
void clearWifiCredentials();

void resetButtonBegin();
void pollResetButton();
