#include <unity.h>
#include <reading.h>

void setUp(void) {}
void tearDown(void) {}

static const float HUMIDITY_48 = 48.0f;

void valid_reading_passes(void) {
  TEST_ASSERT_TRUE(isPlausibleReading(21.5f, &HUMIDITY_48, 1013.0f));
}

void nan_is_rejected(void) {
  static const float nanHumidity = NAN;
  TEST_ASSERT_FALSE(isPlausibleReading(NAN, &HUMIDITY_48, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &nanHumidity, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &HUMIDITY_48, NAN));
}

// 0.0 is the library's readPressure() divide-by-zero fallback.
void zero_pressure_is_rejected(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &HUMIDITY_48, 0.0f));
}

void out_of_range_is_rejected(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(-60.0f, &HUMIDITY_48, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(120.0f, &HUMIDITY_48, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &HUMIDITY_48, 250.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &HUMIDITY_48, 1200.0f));
}

// A BME280 that has dropped off the bus returns stale garbage, which for the
// humidity register lands outside 0-100 %RH far more often than it lands
// inside it - and the backend rejects the whole payload with a 400 if it does
// arrive, losing the temperature and pressure with it.
void out_of_range_humidity_is_rejected(void) {
  static const float belowRange = -0.5f;
  static const float aboveRange = 100.5f;
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &belowRange, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, &aboveRange, 1013.0f));
}

void in_range_boundaries_pass(void) {
  TEST_ASSERT_TRUE(isPlausibleReading(-39.9f, &HUMIDITY_48, 300.1f));
  TEST_ASSERT_TRUE(isPlausibleReading(84.9f, &HUMIDITY_48, 1099.9f));
}

// Unlike the temperature and pressure limits, which are the sensor's spec
// edges, 0 and 100 %RH are ordinary weather: saturated air in fog or rain
// reads a hard 100. Excluding the endpoints the way the other two fields do
// would drop real readings, and SENSOR_BOUNDS in @ws/shared is inclusive too.
void humidity_endpoints_pass(void) {
  static const float dry = 0.0f;
  static const float saturated = 100.0f;
  TEST_ASSERT_TRUE(isPlausibleReading(21.5f, &dry, 1013.0f));
  TEST_ASSERT_TRUE(isPlausibleReading(21.5f, &saturated, 1013.0f));
}

// A BMP280 unit has no humidity element at all. That is not a fault, so the
// temperature and pressure must still pass the gate - otherwise every window
// on such a device is discarded and it uploads nothing.
void absent_humidity_passes(void) {
  TEST_ASSERT_TRUE(isPlausibleReading(21.5f, NULL, 1013.0f));
}

// Absent humidity must not become a blanket bypass: the other two fields are
// still gated on a device with no humidity element.
void absent_humidity_still_checks_the_other_fields(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(120.0f, NULL, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, NULL, 0.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(NAN, NULL, 1013.0f));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(valid_reading_passes);
  RUN_TEST(nan_is_rejected);
  RUN_TEST(zero_pressure_is_rejected);
  RUN_TEST(out_of_range_is_rejected);
  RUN_TEST(out_of_range_humidity_is_rejected);
  RUN_TEST(in_range_boundaries_pass);
  RUN_TEST(humidity_endpoints_pass);
  RUN_TEST(absent_humidity_passes);
  RUN_TEST(absent_humidity_still_checks_the_other_fields);
  return UNITY_END();
}
