#include <unity.h>
#include <reading.h>

void setUp(void) {}
void tearDown(void) {}

void valid_reading_passes(void) {
  TEST_ASSERT_TRUE(isPlausibleReading(21.5f, 1013.0f));
}

void nan_is_rejected(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(NAN, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, NAN));
}

// 0.0 is the library's readPressure() divide-by-zero fallback.
void zero_pressure_is_rejected(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, 0.0f));
}

void out_of_range_is_rejected(void) {
  TEST_ASSERT_FALSE(isPlausibleReading(-60.0f, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(120.0f, 1013.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, 250.0f));
  TEST_ASSERT_FALSE(isPlausibleReading(21.5f, 1200.0f));
}

void in_range_boundaries_pass(void) {
  TEST_ASSERT_TRUE(isPlausibleReading(-39.9f, 300.1f));
  TEST_ASSERT_TRUE(isPlausibleReading(84.9f, 1099.9f));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(valid_reading_passes);
  RUN_TEST(nan_is_rejected);
  RUN_TEST(zero_pressure_is_rejected);
  RUN_TEST(out_of_range_is_rejected);
  RUN_TEST(in_range_boundaries_pass);
  return UNITY_END();
}
