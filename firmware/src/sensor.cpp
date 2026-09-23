#include "sensor.h"

#include <Wire.h>
#include <Adafruit_BME280.h>
#include <Adafruit_BMP280.h>
#include <reading.h>

// 0x76 on most GY-BME280 breakouts, 0x77 on Adafruit boards.
static const uint8_t SENSOR_ADDR[] = {0x76, 0x77};

// Bosch reports the part number in register 0xD0. Both Adafruit drivers check
// it in begin() and refuse to talk to the other part, so the chip ID is read
// here first and the driver chosen from it - begin() failing tells you only
// "not my part", never which part is actually on the bus.
//
// Supporting both is deliberate (MRP-47): the BME280 is pin- and
// address-compatible with the BMP280 prototype, so one image serves a board
// that has been upgraded and one that has not. A BMP280 unit reports humidity
// as null, which is exactly why the field stays nullable in @ws/shared.
static const uint8_t REG_CHIPID = 0xD0;
static const uint8_t CHIPID_BME280 = 0x60;
// 0x58 is the production BMP280; 0x56/0x57 are engineering samples that some
// cheap breakouts still ship.
static const uint8_t CHIPID_BMP280[] = {0x58, 0x56, 0x57};

enum SensorKind { SENSOR_NONE, SENSOR_BME280, SENSOR_BMP280 };
static SensorKind sensorKind = SENSOR_NONE;
static const uint32_t READ_INTERVAL = 2000;
// current sea-level pressure (QNH) — update to local weather report when altitude drifts
static const float SEA_LEVEL_HPA = 1020.2f;

static Adafruit_BME280 bme;
static Adafruit_BMP280 bmp;
static bool ready = false;
static uint32_t lastRead = 0;

static bool chipIdWarned = false;
static bool sensorWarned = false;

// The bus scan is the line that actually explains a missing sensor, and running
// it only in setup() put it out of reach of anyone who attached the serial
// monitor after boot - which is the normal case, since `pio device monitor`
// connects to a board that is already running. Repeated on a slow cadence
// instead, so attaching the monitor at any time surfaces the diagnostic without
// having to reset the board, while staying far quieter than the 2 s read loop.
static const uint32_t SENSOR_SCAN_INTERVAL_MS = 30000;
static uint32_t lastSensorScan = 0;

const char *sensorName() {
  if (sensorKind == SENSOR_BME280) return "BME280";
  if (sensorKind == SENSOR_BMP280) return "BMP280";
  return "sensor";
}

static bool isBmp280ChipId(uint8_t chipId) {
  for (size_t i = 0; i < sizeof(CHIPID_BMP280); i++) {
    if (chipId == CHIPID_BMP280[i]) return true;
  }
  return false;
}

static bool readChipId(uint8_t addr, uint8_t &chipId) {
  Wire.beginTransmission(addr);
  Wire.write(REG_CHIPID);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(addr, (uint8_t)1) != 1) return false;
  chipId = Wire.read();
  return true;
}

// Logged when no sensor is found, so the serial output distinguishes the three
// things that look identical from the driver's side: nothing on the bus at all
// (wiring, power), something on the bus at an unexpected address, and the
// right address holding the wrong part.
static void scanI2cBus() {
  uint8_t found = 0;
  for (uint8_t addr = 0x08; addr < 0x78; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.printf("  I2C device responds at 0x%02X\n", addr);
      found++;
    }
  }
  if (found == 0) {
    Serial.println("  no I2C device responded at any address. The ESP32 side is fine -");
    Serial.println("  it just drove this scan - so the fault is the path or the module:");
    Serial.println("    - continuity, module pad to ESP32 pin: VIN-3V3, GND-GND,");
    Serial.println("      SDA-GPIO21, SCL-GPIO22 (perfboard pads are isolated, every");
    Serial.println("      connection must be a wire or a deliberate solder bridge)");
    Serial.println("    - no short between SDA and SCL, or either to GND");
    Serial.println("    - 3.3 V across the module's own VIN and GND pads while powered");
    Serial.println("    - SDA and SCL both idle near 3.3 V; a line sitting at 0 V is");
    Serial.println("      shorted or held down");
  }
}

// Wire.begin() is NOT called here: initSensor() is retried every READ_INTERVAL
// while no sensor answers, and re-initialising the I2C peripheral underneath a
// bus that is mid-recovery is its own source of trouble. sensorBegin() brings
// the bus up once.
static bool initSensor() {
  for (size_t i = 0; i < sizeof(SENSOR_ADDR); i++) {
    const uint8_t addr = SENSOR_ADDR[i];
    uint8_t chipId = 0;
    if (!readChipId(addr, chipId)) continue;

    if (chipId == CHIPID_BME280) {
      if (!bme.begin(addr)) continue;
      // Argument order differs from the BMP280 driver below: humidity
      // oversampling sits between pressure and the filter, so the four
      // sampling arguments here are temperature, pressure, humidity, filter.
      bme.setSampling(Adafruit_BME280::MODE_FORCED,
                      Adafruit_BME280::SAMPLING_X1,
                      Adafruit_BME280::SAMPLING_X1,
                      Adafruit_BME280::SAMPLING_X1,
                      Adafruit_BME280::FILTER_OFF);
      sensorKind = SENSOR_BME280;
      chipIdWarned = false;
      sensorWarned = false;
      Serial.printf("BME280 at 0x%02X - temperature, humidity, pressure\n", addr);
      return true;
    }

    if (isBmp280ChipId(chipId)) {
      if (!bmp.begin(addr)) continue;
      bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                      Adafruit_BMP280::SAMPLING_X1,
                      Adafruit_BMP280::SAMPLING_X1,
                      Adafruit_BMP280::FILTER_OFF);
      sensorKind = SENSOR_BMP280;
      chipIdWarned = false;
      sensorWarned = false;
      Serial.printf("BMP280 at 0x%02X - temperature, pressure; humidity reports null\n", addr);
      return true;
    }

    // Warned once, like checkIdentity() and checkApiUrlScheme(): initSensor()
    // is retried every READ_INTERVAL, and a part that answers with the wrong
    // chip ID cannot start answering with the right one - repeating the line
    // every 2 s would bury the boot-time bus scan that explains it.
    if (!chipIdWarned) {
      chipIdWarned = true;
      Serial.printf("0x%02X holds chip ID 0x%02X, which is neither a BME280 (0x60) "
                    "nor a BMP280 (0x58)\n", addr, chipId);
    }
  }

  sensorKind = SENSOR_NONE;
  return false;
}

void sensorBegin() {
  Wire.begin();

  ready = initSensor();
  if (!ready) {
    Serial.println("No BME280 or BMP280 found, retrying... scanning the I2C bus:");
    scanI2cBus();
    sensorWarned = true;
    lastSensorScan = millis();
  }
}

bool sensorPoll(SensorSample &out) {
  if (millis() - lastRead < READ_INTERVAL) return false;
  lastRead = millis();

  if (!ready) {
    ready = initSensor();
    if (!ready) {
      // Warned once rather than every 2 s: the repeat says nothing new and
      // scrolls the bus scan below out of the terminal.
      if (!sensorWarned) {
        sensorWarned = true;
        Serial.println("No BME280 or BMP280 on the I2C bus");
      }
      if (millis() - lastSensorScan >= SENSOR_SCAN_INTERVAL_MS) {
        lastSensorScan = millis();
        Serial.println("Scanning the I2C bus:");
        scanI2cBus();
      }
      return false;
    }
    Serial.println("Sensor is back");
  }

  float t = NAN;
  float h = NAN;
  float p = NAN;

  if (sensorKind == SENSOR_BME280) {
    bme.takeForcedMeasurement();
    t = bme.readTemperature() - 3;
    h = bme.readHumidity();
    p = bme.readPressure() / 100.0f;
  } else {
    bmp.takeForcedMeasurement();
    t = bmp.readTemperature() - 3;
    p = bmp.readPressure() / 100.0f;
  }

  // NULL on a BMP280, which has no humidity element - the payload reports null
  // rather than a fabricated number.
  const float *humidity = (sensorKind == SENSOR_BME280) ? &h : NULL;

  if (!isPlausibleReading(t, humidity, p)) {
    Serial.printf("%s reading out of range, re-initialising\n", sensorName());
    ready = false;
    sensorKind = SENSOR_NONE;
    return false;
  }

  float alt = 44330.0f * (1.0f - powf(p / SEA_LEVEL_HPA, 0.1903f));

  if (humidity != NULL) {
    Serial.printf("temp=%.2f C  humidity=%.1f %%  pressure=%.1f hPa  altitude=%.1f m\n",
                  t, h, p, alt);
  } else {
    Serial.printf("temp=%.2f C  pressure=%.1f hPa  altitude=%.1f m\n", t, p, alt);
  }

  out.temperature = t;
  out.humidity = h;
  out.hasHumidity = humidity != NULL;
  out.pressure = p;
  return true;
}
