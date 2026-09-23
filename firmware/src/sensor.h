#pragma once

#include <Arduino.h>

// One BME280/BMP280 on the I2C bus, its detection, its retry cadence and the
// plausibility gate. The caller sees only whole samples: sensorPoll() answers
// "is there a fresh reading this tick", everything about which part is fitted
// and how it is being re-probed stays in here.
struct SensorSample {
  float temperature;
  float humidity;   // meaningful only when hasHumidity is true
  bool hasHumidity; // false on a BMP280, which has no humidity element
  float pressure;
};

// Brings the bus up and probes once, logging the diagnostic scan if nothing
// answers. Called from setup(); sensorPoll() keeps retrying after that.
void sensorBegin();

// True when a fresh, plausible sample is available - at most one per
// READ_INTERVAL. Handles re-detection and the out-of-range reset internally.
bool sensorPoll(SensorSample &out);

const char *sensorName();
