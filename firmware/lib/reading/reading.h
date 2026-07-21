#pragma once
#include <math.h>

// BMP280 spec range: temp -40..85 C, pressure 300..1100 hPa. A sensor that has
// dropped off the bus returns stale garbage rather than NaN, so bound-check.
inline bool isPlausibleReading(float tempC, float pressureHpa) {
  if (isnan(tempC) || isnan(pressureHpa)) return false;
  return tempC > -40.0f && tempC < 85.0f &&
         pressureHpa > 300.0f && pressureHpa < 1100.0f;
}
