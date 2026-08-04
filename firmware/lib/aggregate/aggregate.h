#pragma once
#include <stdint.h>

// One upload window's worth of sensor samples. The sums are double because a
// five-minute window holds 150 samples at the 2 s read interval, and a float
// sum of 150 pressure readings loses the last decimal we actually report.
struct SampleAccumulator {
  uint32_t count;
  double temperatureSum;
  double pressureSum;
};

inline void accumulatorReset(SampleAccumulator &a) {
  a.count = 0;
  a.temperatureSum = 0.0;
  a.pressureSum = 0.0;
}

inline void accumulatorAdd(SampleAccumulator &a, float temperature, float pressure) {
  a.count++;
  a.temperatureSum += temperature;
  a.pressureSum += pressure;
}

// False when the window collected nothing. The caller must skip the upload
// entirely rather than send a zero, which would be indistinguishable from a
// real reading once it is in the database.
inline bool accumulatorMean(const SampleAccumulator &a, float &temperature,
                            float &pressure) {
  if (a.count == 0) return false;
  temperature = (float)(a.temperatureSum / a.count);
  pressure = (float)(a.pressureSum / a.count);
  return true;
}
