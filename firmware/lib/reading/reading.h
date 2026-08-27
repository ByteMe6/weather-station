#pragma once
#include <math.h>
#include <stddef.h>

// BME280 spec range: temp -40..85 C, humidity 0..100 %RH, pressure 300..1100
// hPa. A sensor that has dropped off the bus returns stale garbage rather than
// NaN, so bound-check.
//
// humidityPct is NULL on a unit whose sensor has no humidity element (a
// BMP280 - see initSensor() in main.cpp, which picks the driver from the chip
// ID). That is a property of the board, not a fault, so the temperature and
// pressure are still gated normally; only the humidity bound is skipped.
//
// Humidity is bounded inclusively while the other two are exclusive: -40/85 C
// and 300/1100 hPa are the datasheet's outer edges, but 0 and 100 %RH are
// ordinary weather (saturated air in fog or rain reads a hard 100), and
// SENSOR_BOUNDS in @ws/shared accepts them too. Rejecting the endpoints here
// would drop real readings.
inline bool isPlausibleReading(float tempC, const float *humidityPct,
                               float pressureHpa) {
  if (isnan(tempC) || isnan(pressureHpa)) return false;
  if (humidityPct != NULL) {
    if (isnan(*humidityPct)) return false;
    if (*humidityPct < 0.0f || *humidityPct > 100.0f) return false;
  }
  return tempC > -40.0f && tempC < 85.0f &&
         pressureHpa > 300.0f && pressureHpa < 1100.0f;
}
