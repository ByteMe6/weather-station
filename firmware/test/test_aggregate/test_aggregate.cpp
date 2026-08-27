#include <unity.h>
#include <aggregate.h>
#include <math.h>

void setUp(void) {}
void tearDown(void) {}

// accumulatorAdd takes humidity by pointer so a BMP280 unit, which has no
// humidity element, can add a sample without inventing a value for it.
static void addSample(SampleAccumulator &a, float t, float h, float p) {
  accumulatorAdd(a, t, &h, p);
}

void mean_of_known_samples(void) {
  SampleAccumulator a;
  accumulatorReset(a);
  addSample(a, 20.0f, 40.0f, 1000.0f);
  addSample(a, 22.0f, 50.0f, 1002.0f);
  addSample(a, 24.0f, 60.0f, 1004.0f);

  float t = 0.0f;
  float h = 0.0f;
  float p = 0.0f;
  bool hasHumidity = false;
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_TRUE(hasHumidity);
  TEST_ASSERT_EQUAL_UINT32(3, a.count);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 22.0f, t);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 50.0f, h);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1002.0f, p);
}

// An empty window must not produce a reading - sending a fabricated 0 C would
// look like real data in the database.
void empty_window_has_no_mean(void) {
  SampleAccumulator a;
  accumulatorReset(a);

  float t = -1.0f;
  float h = -1.0f;
  float p = -1.0f;
  bool hasHumidity = true;
  TEST_ASSERT_FALSE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, t);  // outputs left untouched
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, h);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, p);
}

// A reset that clears count but leaks a sum would still return false from
// accumulatorMean here, so prove it by averaging fresh samples afterwards:
// a leaked sum shows up immediately in the mean.
void reset_clears_previous_window(void) {
  SampleAccumulator a;
  accumulatorReset(a);
  addSample(a, 30.0f, 90.0f, 900.0f);

  accumulatorReset(a);
  TEST_ASSERT_EQUAL_UINT32(0, a.count);

  float t = 0.0f;
  float h = 0.0f;
  float p = 0.0f;
  bool hasHumidity = false;
  TEST_ASSERT_FALSE(accumulatorMean(a, t, h, hasHumidity, p));

  addSample(a, 10.0f, 30.0f, 1000.0f);
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 10.0f, t);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 30.0f, h);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1000.0f, p);
}

// Same constant added 150 times sums exactly even in float, so vary the
// samples - otherwise narrowing the sums back to float would pass unnoticed.
//
// The regression check is on the raw sums, not the /150 mean: dividing by
// 150 shrinks a float sum's rounding error to a couple of float ULPs at the
// mean's magnitude (~1e-4), which is indistinguishable from ordinary
// compiler/platform rounding noise and made this test pass even with the
// sums narrowed to float. The undivided sum carries the full error
// (empirically ~0.006 hPa here) with a wide, stable margin over the ~0
// double-precision baseline. Unity's double asserts are compiled out on
// this platform (UNITY_INCLUDE_DOUBLE is off), so the comparison is done by
// hand rather than through TEST_ASSERT_DOUBLE_WITHIN.
void full_window_does_not_drift(void) {
  SampleAccumulator a;
  accumulatorReset(a);

  double expectedTemperatureSum = 0.0;
  double expectedHumiditySum = 0.0;
  double expectedPressureSum = 0.0;
  for (int i = 0; i < 150; i++) {
    float temperature = 21.7f + 0.013f * i;
    float humidity = 47.3f + 0.011f * i;
    float pressure = 1013.25f + 0.017f * i;
    addSample(a, temperature, humidity, pressure);
    expectedTemperatureSum += temperature;
    expectedHumiditySum += humidity;
    expectedPressureSum += pressure;
  }

  TEST_ASSERT_EQUAL_UINT32(150, a.count);
  TEST_ASSERT_TRUE(fabs(a.temperatureSum - expectedTemperatureSum) < 0.0001);
  TEST_ASSERT_TRUE(fabs(a.humiditySum - expectedHumiditySum) < 0.0001);
  TEST_ASSERT_TRUE(fabs(a.pressureSum - expectedPressureSum) < 0.0001);

  float t = 0.0f;
  float h = 0.0f;
  float p = 0.0f;
  bool hasHumidity = false;
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, (float)(expectedTemperatureSum / 150.0), t);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, (float)(expectedHumiditySum / 150.0), h);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, (float)(expectedPressureSum / 150.0), p);
}

void negative_temperatures_average_correctly(void) {
  SampleAccumulator a;
  accumulatorReset(a);
  addSample(a, -10.0f, 80.0f, 1000.0f);
  addSample(a, 10.0f, 80.0f, 1000.0f);

  float t = 0.0f;
  float h = 0.0f;
  float p = 0.0f;
  bool hasHumidity = false;
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 0.0f, t);
}

// A BMP280 unit adds every sample with a NULL humidity. The window still has
// a usable temperature and pressure mean - it just has no humidity to report,
// and must say so rather than averaging an untouched sum to a plausible 0.00.
void window_without_humidity_reports_none(void) {
  SampleAccumulator a;
  accumulatorReset(a);
  accumulatorAdd(a, 20.0f, NULL, 1000.0f);
  accumulatorAdd(a, 22.0f, NULL, 1002.0f);

  float t = 0.0f;
  float h = -1.0f;
  float p = 0.0f;
  bool hasHumidity = true;
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_FALSE(hasHumidity);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, -1.0f, h);  // output left untouched
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 21.0f, t);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 1001.0f, p);
}

// The humidity mean divides by the number of samples that actually carried
// one, not by the window's total sample count - otherwise a window that lost
// the humidity element partway through would report a mean diluted toward
// zero rather than the average of what was measured.
void humidity_mean_uses_only_the_samples_that_had_it(void) {
  SampleAccumulator a;
  accumulatorReset(a);
  addSample(a, 20.0f, 40.0f, 1000.0f);
  addSample(a, 20.0f, 60.0f, 1000.0f);
  accumulatorAdd(a, 20.0f, NULL, 1000.0f);

  float t = 0.0f;
  float h = 0.0f;
  float p = 0.0f;
  bool hasHumidity = false;
  TEST_ASSERT_TRUE(accumulatorMean(a, t, h, hasHumidity, p));
  TEST_ASSERT_TRUE(hasHumidity);
  TEST_ASSERT_FLOAT_WITHIN(0.001f, 50.0f, h);
  TEST_ASSERT_EQUAL_UINT32(3, a.count);
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(mean_of_known_samples);
  RUN_TEST(empty_window_has_no_mean);
  RUN_TEST(reset_clears_previous_window);
  RUN_TEST(full_window_does_not_drift);
  RUN_TEST(negative_temperatures_average_correctly);
  RUN_TEST(window_without_humidity_reports_none);
  RUN_TEST(humidity_mean_uses_only_the_samples_that_had_it);
  return UNITY_END();
}
