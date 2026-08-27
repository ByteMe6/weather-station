#include <unity.h>
#include <upload.h>
#include <string.h>
#include <math.h>

void setUp(void) {}
void tearDown(void) {}

void formats_epoch_zero(void) {
  char out[32];
  TEST_ASSERT_TRUE(formatIso8601Utc(0, out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("1970-01-01T00:00:00Z", out);
}

void formats_a_known_epoch(void) {
  char out[32];
  TEST_ASSERT_TRUE(formatIso8601Utc(1000000000, out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("2001-09-09T01:46:40Z", out);
}

// Zero-padding matters: the backend parses with zod .datetime(), which rejects
// a single-digit month or hour.
void pads_single_digit_fields(void) {
  char out[32];
  TEST_ASSERT_TRUE(formatIso8601Utc(1785844800, out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("2026-08-04T12:00:00Z", out);
}

// 20 characters plus the terminator. Anything smaller must fail loudly rather
// than emit a truncated timestamp that the backend would reject as a 400.
void rejects_undersized_buffer(void) {
  char out[20];
  TEST_ASSERT_FALSE(formatIso8601Utc(0, out, sizeof(out)));
}

// INT32_MAX is the last second ESP32's 32-bit signed time_t can represent
// without wrapping - confirmed against `date -u -d @2147483647`.
void formats_int32_max_epoch(void) {
  char out[32];
  TEST_ASSERT_TRUE(formatIso8601Utc(2147483647LL, out, sizeof(out)));
  TEST_ASSERT_EQUAL_STRING("2038-01-19T03:14:07Z", out);
}

// One second past INT32_MAX would silently wrap to a different valid date
// once narrowed to ESP32's 32-bit time_t - refuse instead of guessing wrong.
void rejects_epoch_past_int32_max(void) {
  char out[32];
  TEST_ASSERT_FALSE(formatIso8601Utc(2147483648LL, out, sizeof(out)));
}

// A reading timestamped before 1970 means the device's clock hasn't been set
// (or is corrupted), not that the reading is genuinely that old - refuse it
// rather than sign and upload a bogus timestamp as if it were real.
void rejects_epoch_before_1970(void) {
  char out[32];
  TEST_ASSERT_FALSE(formatIso8601Utc(-1, out, sizeof(out)));
}

// Humidity is passed by pointer: NULL means the unit has no humidity element
// (a BMP280) and the field must serialize as JSON null.
static size_t buildBody(const char *iso, float t, float h, float p, char *out,
                        size_t outLen) {
  return buildReadingBody(iso, t, &h, p, out, outLen);
}

void builds_exact_payload(void) {
  char body[256];
  size_t n = buildBody("2026-08-04T12:00:00Z", 21.53f, 47.8f, 1013.24f,
                       body, sizeof(body));
  TEST_ASSERT_EQUAL_STRING(
      "{\"timestamp\":\"2026-08-04T12:00:00Z\",\"temperature\":21.53,"
      "\"humidity\":47.80,\"pressure\":1013.24,\"windSpeed\":null,"
      "\"windDirection\":null,\"precipitation\":null}",
      body);
  TEST_ASSERT_EQUAL_UINT32(151, n);
  TEST_ASSERT_EQUAL_UINT32(strlen(body), n);
}

// Values are rounded to two decimals on the way out, so the body is identical
// no matter how the float landed - the signature covers these exact bytes.
//
// Matches include the trailing comma so this is anchored on both sides: a
// bare `strstr(body, "\"temperature\":21.53")` would also match "21.53456"
// and silently pass even if the %.2f rounding were broken.
void rounds_to_two_decimals(void) {
  char body[256];
  TEST_ASSERT_TRUE(buildBody("2026-08-04T12:00:00Z", 21.53456f, 47.79512f,
                             1013.23891f, body, sizeof(body)) > 0);
  TEST_ASSERT_NOT_NULL(strstr(body, "\"temperature\":21.53,"));
  TEST_ASSERT_NOT_NULL(strstr(body, "\"humidity\":47.80,"));
  TEST_ASSERT_NOT_NULL(strstr(body, "\"pressure\":1013.24,"));
}

// Negative readings must keep their sign through the formatter.
void formats_negative_temperature(void) {
  char body[256];
  TEST_ASSERT_TRUE(buildBody("2026-08-04T12:00:00Z", -5.30f, 47.8f,
                             1013.24f, body, sizeof(body)) > 0);
  TEST_ASSERT_NOT_NULL(strstr(body, "\"temperature\":-5.30,"));
}

// %.2f must keep trailing zeros - the main hedge against someone reverting to
// ArduinoJson's own float rendering (which drops them), breaking the
// byte-exactness the signature scheme depends on.
void preserves_trailing_zeros(void) {
  char body[256];
  TEST_ASSERT_TRUE(buildBody("2026-08-04T12:00:00Z", 21.5f, 47.0f, 1013.2f,
                             body, sizeof(body)) > 0);
  TEST_ASSERT_NOT_NULL(strstr(body, "\"temperature\":21.50,"));
  TEST_ASSERT_NOT_NULL(strstr(body, "\"humidity\":47.00,"));
  TEST_ASSERT_NOT_NULL(strstr(body, "\"pressure\":1013.20,"));
}

// Rounding that carries into the integer part (21.999 -> 22.00, not 21.100
// or a dropped digit) must render correctly.
void rounds_with_carry_across_decimal(void) {
  char body[256];
  TEST_ASSERT_TRUE(buildBody("2026-08-04T12:00:00Z", 21.999f, 47.8f,
                             1013.24f, body, sizeof(body)) > 0);
  TEST_ASSERT_NOT_NULL(strstr(body, "\"temperature\":22.00,"));
}

// A NaN would serialize as bare `nan`, which is not valid JSON - the backend
// would reject the body as a 400 and the reading would be lost with a
// misleading error.
void rejects_non_finite_values(void) {
  char body[256];
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", (float)NAN,
                                        47.8f, 1013.24f, body, sizeof(body)));
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", 21.53f,
                                        (float)NAN, 1013.24f, body, sizeof(body)));
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", 21.53f, 47.8f,
                                        (float)INFINITY, body, sizeof(body)));
}

void rejects_undersized_body_buffer(void) {
  char body[32];
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", 21.53f,
                                        47.8f, 1013.24f, body, sizeof(body)));
}

// buildReadingBody does not itself enforce the BME280 plausibility range, so
// nothing stops an ungated caller from passing an absurd-but-finite value.
// %.2f on 1e30f needs far more than 15 chars; snprintf would truncate it
// silently rather than fail, producing a wrong-but-plausible number that then
// gets signed and stored. Must be refused instead.
void rejects_value_that_would_truncate_number_buffer(void) {
  char body[256];
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", 1e30f,
                                        47.8f, 1013.24f, body, sizeof(body)));
  TEST_ASSERT_EQUAL_UINT32(0, buildBody("2026-08-04T12:00:00Z", 21.53f,
                                        1e30f, 1013.24f, body, sizeof(body)));
}

// A BMP280 unit has no humidity element, so the field goes out as JSON null
// rather than a fabricated number. This is byte-for-byte the body the firmware
// sent before MRP-47 fitted the BME280.
void builds_payload_without_humidity(void) {
  char body[256];
  size_t n = buildReadingBody("2026-08-04T12:00:00Z", 21.53f, NULL, 1013.24f,
                              body, sizeof(body));
  TEST_ASSERT_EQUAL_STRING(
      "{\"timestamp\":\"2026-08-04T12:00:00Z\",\"temperature\":21.53,"
      "\"humidity\":null,\"pressure\":1013.24,\"windSpeed\":null,"
      "\"windDirection\":null,\"precipitation\":null}",
      body);
  TEST_ASSERT_EQUAL_UINT32(150, n);
}

// The absent-humidity path must not skip the checks that apply to the fields
// that ARE present - it is a narrower payload, not an ungated one.
void payload_without_humidity_still_gates_other_fields(void) {
  char body[256];
  TEST_ASSERT_EQUAL_UINT32(0, buildReadingBody("2026-08-04T12:00:00Z", (float)NAN,
                                               NULL, 1013.24f, body, sizeof(body)));
  TEST_ASSERT_EQUAL_UINT32(0, buildReadingBody("2026-08-04T12:00:00Z", 1e30f,
                                               NULL, 1013.24f, body, sizeof(body)));
}

// Fixture generated with the same construction apps/web/src/lib/ingest/
// verify-signature.ts verifies:
//   crypto.createHmac('sha256', SECRET).update(`${TS}.${BODY}`).digest('hex')
// The secret is used as UTF-8 text, NOT decoded from hex - matching the route.
static const char FIXTURE_SECRET[] =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
static const char FIXTURE_TIMESTAMP[] = "1785844800000";
static const char FIXTURE_BODY[] =
    "{\"timestamp\":\"2026-08-04T12:00:00Z\",\"temperature\":21.53,"
    "\"humidity\":47.80,\"pressure\":1013.24,\"windSpeed\":null,"
    "\"windDirection\":null,\"precipitation\":null}";
static const char FIXTURE_SIGNATURE[] =
    "a28359a9c7c9b68f0ea5fa32dedcdad87fa1b8b56cbe74e7f9ca98a9223325f2";

// The pre-MRP-47 body and its signature, kept so a BMP280 unit's payload is
// still pinned against the backend's verifier rather than only the BME280 one.
static const char LEGACY_NULL_HUMIDITY_BODY[] =
    "{\"timestamp\":\"2026-08-04T12:00:00Z\",\"temperature\":21.53,"
    "\"humidity\":null,\"pressure\":1013.24,\"windSpeed\":null,"
    "\"windDirection\":null,\"precipitation\":null}";
static const char LEGACY_NULL_HUMIDITY_SIGNATURE[] =
    "fc89c41ab6892f82b9f4ad375ce9b87a2edbe5f46395c992e3c1d36bc5267daf";

void signature_matches_the_backend_without_humidity(void) {
  char body[256];
  char sig[65];
  TEST_ASSERT_TRUE(buildReadingBody("2026-08-04T12:00:00Z", 21.53f, NULL, 1013.24f,
                                    body, sizeof(body)) > 0);
  TEST_ASSERT_EQUAL_STRING(LEGACY_NULL_HUMIDITY_BODY, body);
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, body,
                               sig, sizeof(sig)));
  TEST_ASSERT_EQUAL_STRING(LEGACY_NULL_HUMIDITY_SIGNATURE, sig);
}

void signature_matches_the_backend(void) {
  char sig[65];
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, FIXTURE_BODY,
                               sig, sizeof(sig)));
  TEST_ASSERT_EQUAL_STRING(FIXTURE_SIGNATURE, sig);
}

// The route's regex demands exactly 64 lowercase hex characters.
void signature_is_lowercase_hex(void) {
  char sig[65];
  // Pre-fill with known non-zero garbage so the terminator check below is
  // deterministic - relying on whatever happened to be on the stack would
  // let a missing outHex[64] = '\0' pass or fail by luck.
  memset(sig, 'Z', sizeof(sig));
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, FIXTURE_BODY,
                               sig, sizeof(sig)));
  TEST_ASSERT_EQUAL_CHAR('\0', sig[64]);  // pinned explicitly: stack garbage
                                          // must not be what makes this pass
  TEST_ASSERT_EQUAL_UINT32(64, strlen(sig));
  for (size_t i = 0; i < 64; i++) {
    bool isHex = (sig[i] >= '0' && sig[i] <= '9') || (sig[i] >= 'a' && sig[i] <= 'f');
    TEST_ASSERT_TRUE(isHex);
  }
}

// The separator is load-bearing: signing the concatenation without the dot
// would let a different timestamp/body split produce the same signature.
void signature_changes_with_the_timestamp(void) {
  char a[65];
  char b[65];
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, FIXTURE_BODY, a, sizeof(a)));
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, "1785844800001", FIXTURE_BODY, b, sizeof(b)));
  TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

void signature_changes_with_the_secret(void) {
  char a[65];
  char b[65];
  TEST_ASSERT_TRUE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, FIXTURE_BODY, a, sizeof(a)));
  TEST_ASSERT_TRUE(signPayload("a different secret", FIXTURE_TIMESTAMP, FIXTURE_BODY, b, sizeof(b)));
  TEST_ASSERT_TRUE(strcmp(a, b) != 0);
}

void signature_rejects_undersized_buffer(void) {
  char sig[64];  // one short of the 64 hex chars plus terminator
  TEST_ASSERT_FALSE(signPayload(FIXTURE_SECRET, FIXTURE_TIMESTAMP, FIXTURE_BODY,
                                sig, sizeof(sig)));
}

void retries_transport_failures_and_server_errors(void) {
  TEST_ASSERT_TRUE(shouldRetryUpload(-1));    // HTTPClient transport failure
  TEST_ASSERT_TRUE(shouldRetryUpload(-11));   // read timeout
  TEST_ASSERT_TRUE(shouldRetryUpload(0));     // no code at all
  TEST_ASSERT_TRUE(shouldRetryUpload(500));
  TEST_ASSERT_TRUE(shouldRetryUpload(503));
}

// A 401 means the signature or the clock is wrong, and a 400 means the payload
// is malformed. Neither fixes itself, so retrying only burns the attempts.
void does_not_retry_client_errors_or_success(void) {
  TEST_ASSERT_FALSE(shouldRetryUpload(201));
  TEST_ASSERT_FALSE(shouldRetryUpload(200));
  TEST_ASSERT_FALSE(shouldRetryUpload(400));
  TEST_ASSERT_FALSE(shouldRetryUpload(401));
  TEST_ASSERT_FALSE(shouldRetryUpload(404));
  TEST_ASSERT_FALSE(shouldRetryUpload(301));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(formats_epoch_zero);
  RUN_TEST(formats_a_known_epoch);
  RUN_TEST(pads_single_digit_fields);
  RUN_TEST(rejects_undersized_buffer);
  RUN_TEST(formats_int32_max_epoch);
  RUN_TEST(rejects_epoch_past_int32_max);
  RUN_TEST(rejects_epoch_before_1970);
  RUN_TEST(builds_exact_payload);
  RUN_TEST(rounds_to_two_decimals);
  RUN_TEST(formats_negative_temperature);
  RUN_TEST(preserves_trailing_zeros);
  RUN_TEST(rounds_with_carry_across_decimal);
  RUN_TEST(rejects_non_finite_values);
  RUN_TEST(rejects_undersized_body_buffer);
  RUN_TEST(rejects_value_that_would_truncate_number_buffer);
  RUN_TEST(builds_payload_without_humidity);
  RUN_TEST(payload_without_humidity_still_gates_other_fields);
  RUN_TEST(signature_matches_the_backend);
  RUN_TEST(signature_matches_the_backend_without_humidity);
  RUN_TEST(signature_is_lowercase_hex);
  RUN_TEST(signature_changes_with_the_timestamp);
  RUN_TEST(signature_changes_with_the_secret);
  RUN_TEST(signature_rejects_undersized_buffer);
  RUN_TEST(retries_transport_failures_and_server_errors);
  RUN_TEST(does_not_retry_client_errors_or_success);
  return UNITY_END();
}
