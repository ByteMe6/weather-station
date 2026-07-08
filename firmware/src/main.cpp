// Entry point. Sensor reading, WiFi provisioning, and the HTTPS ingest loop
// land in subsequent tickets (MRP-11: BME280 driver).
#include <Arduino.h>

void setup() {
  Serial.begin(115200);
}

void loop() {
  delay(1000);
}
