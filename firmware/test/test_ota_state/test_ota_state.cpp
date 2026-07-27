#include <unity.h>
#include <ota_state.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

// 32-byte sha256 = 64 hex chars; 64-byte sig = 88 base64 chars.
static const char GOOD[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"sig\":\"" // 64 bytes of 0x00 in base64
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

void parses_good_manifest(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(GOOD, m));
  TEST_ASSERT_EQUAL_UINT32(2, m.version);
  TEST_ASSERT_EQUAL_STRING("weatherstation-2.bin", m.path);
  TEST_ASSERT_EQUAL_UINT32(1052672, m.size);
  TEST_ASSERT_EQUAL_UINT8(0xaa, m.sha256[0]);
  TEST_ASSERT_EQUAL_UINT8(0x11, m.sha256[31]);
  TEST_ASSERT_EQUAL_UINT8(0x00, m.sig[0]);
  TEST_ASSERT_EQUAL_UINT8(0x00, m.sig[63]);
}

void rejects_garbage_json(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest("not json at all", m));
  TEST_ASSERT_FALSE(parseManifest("", m));
  TEST_ASSERT_FALSE(parseManifest("{}", m));
}

// Each required field missing -> reject.
void rejects_missing_fields(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(
      "{\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"size\":1,\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\"}", m));
}

void rejects_wrong_types_and_values(void) {
  OtaManifest m;
  // version as string
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":\"2\",\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // zero size
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":0,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // empty path
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sha256(void) {
  OtaManifest m;
  // too short (2 chars), and right length but non-hex
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "zz00000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sig(void) {
  OtaManifest m;
  // decodes to 3 bytes, not 64
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAA\"}", m));
  // invalid base64 character
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"!!AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void version_compare_is_strictly_greater(void) {
  TEST_ASSERT_TRUE(isNewerVersion(1, 2));
  TEST_ASSERT_FALSE(isNewerVersion(2, 2));
  TEST_ASSERT_FALSE(isNewerVersion(3, 2));
  TEST_ASSERT_TRUE(isNewerVersion(0, 1));
}

void hex_decoder_roundtrip(void) {
  uint8_t out[4];
  TEST_ASSERT_TRUE(decodeHex("deadBEEF", out, 4));
  TEST_ASSERT_EQUAL_UINT8(0xde, out[0]);
  TEST_ASSERT_EQUAL_UINT8(0xad, out[1]);
  TEST_ASSERT_EQUAL_UINT8(0xbe, out[2]);
  TEST_ASSERT_EQUAL_UINT8(0xef, out[3]);
  TEST_ASSERT_FALSE(decodeHex("dead", out, 4));   // too short
  TEST_ASSERT_FALSE(decodeHex("deadbeefaa", out, 4)); // too long
  TEST_ASSERT_FALSE(decodeHex("deadbeeg", out, 4));   // non-hex
}

void base64_decoder_strict(void) {
  uint8_t out[6];
  TEST_ASSERT_TRUE(decodeBase64("aGVsbG8h", out, 6)); // "hello!"
  TEST_ASSERT_EQUAL_UINT8('h', out[0]);
  TEST_ASSERT_EQUAL_UINT8('!', out[5]);
  uint8_t five[5];
  TEST_ASSERT_TRUE(decodeBase64("aGVsbG8=", five, 5)); // "hello"
  TEST_ASSERT_EQUAL_UINT8('o', five[4]);
  TEST_ASSERT_FALSE(decodeBase64("aGVsbG8=", out, 6));  // wrong out length
  TEST_ASSERT_FALSE(decodeBase64("aGVsbG8", five, 5));  // not multiple of 4
  TEST_ASSERT_FALSE(decodeBase64("aG=sbG8=", five, 5)); // pad mid-group
  TEST_ASSERT_FALSE(decodeBase64("", out, 6));
  // adversarial padding: all pad, pad in position 1, data after pad
  uint8_t one[1];
  TEST_ASSERT_FALSE(decodeBase64("====", one, 1));
  TEST_ASSERT_FALSE(decodeBase64("A===", one, 1));
  uint8_t two[2];
  TEST_ASSERT_FALSE(decodeBase64("AB=A", two, 2));
}

// path[96] holds at most 95 chars + NUL: 95 accepted, 96 rejected.
void path_length_boundary(void) {
  char json[512];
  char path95[96];
  memset(path95, 'p', 95);
  path95[95] = '\0';
  const char *tail =
      "\",\"size\":1,"
      "\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

  OtaManifest m;
  snprintf(json, sizeof(json), "{\"version\":2,\"path\":\"%s%s", path95, tail);
  TEST_ASSERT_TRUE(parseManifest(json, m));
  TEST_ASSERT_EQUAL_UINT32(95, (uint32_t)strlen(m.path));
  TEST_ASSERT_EQUAL_STRING(path95, m.path);

  char path96[97];
  memset(path96, 'p', 96);
  path96[96] = '\0';
  snprintf(json, sizeof(json), "{\"version\":2,\"path\":\"%s%s", path96, tail);
  TEST_ASSERT_FALSE(parseManifest(json, m));
}

// Out-of-range / non-integer numbers must not sneak through as uint32.
void rejects_out_of_range_numbers(void) {
  OtaManifest m;
  const char *tail =
      "\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";
  char json[512];
  snprintf(json, sizeof(json), "{\"version\":-1,%s", tail);
  TEST_ASSERT_FALSE(parseManifest(json, m));
  snprintf(json, sizeof(json), "{\"version\":2.5,%s", tail);
  TEST_ASSERT_FALSE(parseManifest(json, m));
  snprintf(json, sizeof(json), "{\"version\":4294967296,%s", tail);
  TEST_ASSERT_FALSE(parseManifest(json, m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":-1,"
      "\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}",
      m));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(parses_good_manifest);
  RUN_TEST(rejects_garbage_json);
  RUN_TEST(rejects_missing_fields);
  RUN_TEST(rejects_wrong_types_and_values);
  RUN_TEST(rejects_bad_sha256);
  RUN_TEST(rejects_bad_sig);
  RUN_TEST(version_compare_is_strictly_greater);
  RUN_TEST(hex_decoder_roundtrip);
  RUN_TEST(base64_decoder_strict);
  RUN_TEST(path_length_boundary);
  RUN_TEST(rejects_out_of_range_numbers);
  return UNITY_END();
}
