#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BMP280.h>
#include <reading.h>

// 0x76 on most GY-BMP280 breakouts, 0x77 on Adafruit boards.
static const uint8_t BMP_ADDR[] = {0x76, 0x77};
static const uint32_t READ_INTERVAL = 2000;
static const float SEA_LEVEL_HPA = 1013.25f;  // reference for derived altitude

static Adafruit_BMP280 bmp;
static bool ready = false;
static uint32_t lastRead = 0;

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
