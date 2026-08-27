#pragma once
#include <stdint.h>
#include <stddef.h>

// One upload window's worth of sensor samples. The sums are double because a
// five-minute window holds 150 samples at the 2 s read interval, and a float
// sum of 150 pressure readings loses the last decimal we actually report.
//
// humidityCount is tracked separately from count: a BMP280 unit has no
// humidity element and adds every sample without one, so the humidity mean
// must divide by the samples that actually carried a value rather than by the
// window total.
struct SampleAccumulator {
  uint32_t count;
  uint32_t humidityCount;
  double temperatureSum;
  double humiditySum;
  double pressureSum;
};

inline void accumulatorReset(SampleAccumulator &a) {
  a.count = 0;
  a.humidityCount = 0;
  a.temperatureSum = 0.0;
  a.humiditySum = 0.0;
  a.pressureSum = 0.0;
}

// humidity is NULL on a unit with no humidity element. Taken by pointer rather
// than as a value plus a flag so there is no way to pass one and forget the
// other.
inline void accumulatorAdd(SampleAccumulator &a, float temperature,
                           const float *humidity, float pressure) {
  a.count++;
  a.temperatureSum += temperature;
  a.pressureSum += pressure;
  if (humidity != NULL) {
    a.humidityCount++;
    a.humiditySum += *humidity;
  }
}

// False when the window collected nothing. The caller must skip the upload
// entirely rather than send a zero, which would be indistinguishable from a
// real reading once it is in the database.
//
// hasHumidity comes back false when no sample in the window carried a humidity
// value; humidity is then left untouched and the caller must report null. The
// same reasoning as the empty window above: averaging an untouched sum would
// produce a perfectly plausible 0.00 %RH.
inline bool accumulatorMean(const SampleAccumulator &a, float &temperature,
                            float &humidity, bool &hasHumidity, float &pressure) {
  if (a.count == 0) return false;
  temperature = (float)(a.temperatureSum / a.count);
  pressure = (float)(a.pressureSum / a.count);
  hasHumidity = a.humidityCount > 0;
  if (hasHumidity) humidity = (float)(a.humiditySum / a.humidityCount);
  return true;
}
