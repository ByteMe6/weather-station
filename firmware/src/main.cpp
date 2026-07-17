#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>

// 0x76 on most GY-BMP280 breakouts, 0x77 on Adafruit boards.
static const uint8_t BMP_ADDR[] = {0x76, 0x77};
static const uint32_t READ_INTERVAL = 2000;
static const float SEA_LEVEL_HPA = 1013.25f;  // reference for derived altitude

Adafruit_BMP280 bmp;
bool ready = false;
uint32_t lastRead = 0;

bool initSensor() {
  if (!bmp.begin(BMP_ADDR[0]) && !bmp.begin(BMP_ADDR[1])) return false;

  bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::FILTER_OFF);
  return true;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();

  ready = initSensor();
  if (!ready) Serial.println("BMP280 not found, retrying...");
}

void loop() {
  if (millis() - lastRead < READ_INTERVAL) return;
  lastRead = millis();

  if (!ready) {
    ready = initSensor();
    if (!ready) {
      Serial.println("BMP280 unavailable");
      return;
    }
  }

  if (!bmp.takeForcedMeasurement()) {
    Serial.println("BMP280 read failed");
    ready = false;
    return;
  }

  float t = bmp.readTemperature();
  float p = bmp.readPressure() / 100.0f;
  float alt = bmp.readAltitude(SEA_LEVEL_HPA);

  if (isnan(t) || isnan(p)) {
    ready = false;
    return;
  }

  Serial.printf("temp=%.2f C  pressure=%.1f hPa  altitude=%.1f m\n", t, p, alt);
}
