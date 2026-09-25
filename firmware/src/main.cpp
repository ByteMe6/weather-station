#include <Arduino.h>
#include <WiFi.h>

#include "device_config.h"
#include "ota.h"
#include "portal.h"
#include "sensor.h"
#include "uploader.h"
#include "version.h"
#include "wifi_link.h"

// The STATION_CONNECTED branch of the phase machine - everything the device
// does once it has a link. The order is deliberate: the OTA check may reboot
// into a new image, so it runs before any work whose result would be thrown
// away, and the sampler comes last so a sample taken this tick lands in the
// window the next tick closes rather than the one just closed.
static void handleStationConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting");
    uploaderReset("wifi lost mid-upload");
    stopStationWebPortal();
    beginStationConnect();
    return;
  }

  otaTick();

  if (!stationWebPortalRunning()) startStationWebPortal();
  processStationWebPortal();

  uploaderTick();

  SensorSample sample;
  if (sensorPoll(sample)) uploaderAddSample(sample);
}

void setup() {
  Serial.begin(115200);
  Serial.printf("Weather Station fw v%u\n", (uint32_t)FW_VERSION);
  resetButtonBegin();

  sensorBegin();

  wifiBegin();

  loadDeviceIdentity();
  loadApiUrl();
  loadUploadInterval();
  Serial.printf("Device ID: %s\n",
                configDeviceId().length() ? configDeviceId().c_str() : "(none)");
  Serial.printf("Backend URL: %s\n", configApiUrl().c_str());
  if (!hasSavedWifiCredentials()) {
    startSetupPortal();
  } else {
    beginStationConnect();
  }
}

void loop() {
  pollResetButton();

  switch (wifiCurrentPhase()) {
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
