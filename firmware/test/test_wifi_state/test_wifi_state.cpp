#include <unity.h>
#include <wifi_state.h>

void setUp(void) {}
void tearDown(void) {}

void backoff_first_attempt_is_5s(void) {
  TEST_ASSERT_EQUAL_UINT32(5000, nextBackoffMs(1));
}

void backoff_second_attempt_is_10s(void) {
  TEST_ASSERT_EQUAL_UINT32(10000, nextBackoffMs(2));
}

void backoff_third_attempt_is_30s(void) {
  TEST_ASSERT_EQUAL_UINT32(30000, nextBackoffMs(3));
}

void backoff_fourth_attempt_is_60s(void) {
  TEST_ASSERT_EQUAL_UINT32(60000, nextBackoffMs(4));
}

void backoff_caps_at_60s_beyond_fourth_attempt(void) {
  TEST_ASSERT_EQUAL_UINT32(60000, nextBackoffMs(5));
  TEST_ASSERT_EQUAL_UINT32(60000, nextBackoffMs(200));
}

void backoff_zero_attempt_defaults_to_5s(void) {
  TEST_ASSERT_EQUAL_UINT32(5000, nextBackoffMs(0));
}

void reset_not_held_before_hold_duration(void) {
  TEST_ASSERT_FALSE(isResetHeld(1000, 5999, 5000));
}

void reset_held_at_exact_hold_duration(void) {
  TEST_ASSERT_TRUE(isResetHeld(1000, 6000, 5000));
}

void reset_held_well_beyond_hold_duration(void) {
  TEST_ASSERT_TRUE(isResetHeld(1000, 20000, 5000));
}

// Presses straddling the millis() wrap: 2001ms before + 3001ms after = held,
// 2001ms + 2000ms = not yet.
void reset_held_across_millis_wrap(void) {
  TEST_ASSERT_TRUE(isResetHeld(UINT32_MAX - 2000, 3001, 5000));
}

void reset_not_held_across_millis_wrap_below_threshold(void) {
  TEST_ASSERT_FALSE(isResetHeld(UINT32_MAX - 2000, 2000, 5000));
}

void reset_uses_default_hold_of_5s(void) {
  TEST_ASSERT_FALSE(isResetHeld(0, 4999));
  TEST_ASSERT_TRUE(isResetHeld(0, 5000));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(backoff_first_attempt_is_5s);
  RUN_TEST(backoff_second_attempt_is_10s);
  RUN_TEST(backoff_third_attempt_is_30s);
  RUN_TEST(backoff_fourth_attempt_is_60s);
  RUN_TEST(backoff_caps_at_60s_beyond_fourth_attempt);
  RUN_TEST(backoff_zero_attempt_defaults_to_5s);
  RUN_TEST(reset_not_held_before_hold_duration);
  RUN_TEST(reset_held_at_exact_hold_duration);
  RUN_TEST(reset_held_well_beyond_hold_duration);
  RUN_TEST(reset_held_across_millis_wrap);
  RUN_TEST(reset_not_held_across_millis_wrap_below_threshold);
  RUN_TEST(reset_uses_default_hold_of_5s);
  return UNITY_END();
}
