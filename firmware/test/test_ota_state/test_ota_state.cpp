#include <unity.h>
#include <ota_state.h>
#include <string.h>
#include <Ed25519.h>

void setUp(void) {}
void tearDown(void) {}

// 32-byte sha256 = 64 hex chars; 64-byte sig = 88 base64 chars.
static const char GOOD[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"intervalMs\":300000,"
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

// Each required field missing -> reject. Every fixture below carries a valid
// intervalMs: without one they would all be rejected by the intervalMs guard
// before reaching the defect each case is written to catch.
void rejects_missing_fields(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(
      "{\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\",\"intervalMs\":300000,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"size\":1,\"sha256\":\"00\",\"intervalMs\":300000,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"sha256\":\"00\",\"intervalMs\":300000,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"intervalMs\":300000,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\",\"intervalMs\":300000}", m));
}

void rejects_wrong_types_and_values(void) {
  OtaManifest m;
  // version as string
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":\"2\",\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // zero size
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":0,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // empty path
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sha256(void) {
  OtaManifest m;
  // too short (2 chars), and right length but non-hex
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\",\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "zz00000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sig(void) {
  OtaManifest m;
  // decodes to 3 bytes, not 64
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAA\"}", m));
  // invalid base64 character
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"intervalMs\":300000,"
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
      "\"intervalMs\":300000,"
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
      "\"intervalMs\":300000,"
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
      "\"intervalMs\":300000,"
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}",
      m));
}

// Vector from a fixed test key (bytes 0..31), not the production key, signed
// over version 2 + KAT_DIGEST + KAT_INTERVAL. The message is assembled by
// buildOtaSignedMessage() rather than a local copy of the layout, so a change
// to the production layout breaks these tests instead of quietly leaving them
// verifying bytes no device ever sees.
static const uint32_t KAT_INTERVAL = 300000;
static const uint8_t KAT_PUB[32] = {
    0x03, 0xa1, 0x07, 0xbf, 0xf3, 0xce, 0x10, 0xbe,
    0x1d, 0x70, 0xdd, 0x18, 0xe7, 0x4b, 0xc0, 0x99,
    0x67, 0xe4, 0xd6, 0x30, 0x9b, 0xa5, 0x0d, 0x5f,
    0x1d, 0xdc, 0x86, 0x64, 0x12, 0x55, 0x31, 0xb8};
static const uint8_t KAT_DIGEST[32] = {
    0xd7, 0x49, 0xa7, 0xf7, 0x84, 0x19, 0x8f, 0x8c,
    0x0a, 0xa9, 0xef, 0x79, 0xba, 0x5c, 0xa5, 0x6c,
    0xbb, 0xc4, 0x0c, 0x73, 0x10, 0x7a, 0x2b, 0x74,
    0xd1, 0xfe, 0x41, 0x86, 0x90, 0x1f, 0xd1, 0xe1};
static const uint8_t KAT_SIG[64] = {
    0xce, 0xbb, 0xd9, 0xa0, 0x12, 0x5e, 0x83, 0xb7,
    0xcd, 0x62, 0x85, 0x37, 0x3b, 0x72, 0xc6, 0x39,
    0x2c, 0x5a, 0x25, 0x29, 0xac, 0x13, 0x60, 0x9c,
    0x7f, 0xf9, 0x4b, 0x34, 0xca, 0x91, 0x4f, 0xf9,
    0x6b, 0xc8, 0x00, 0x0c, 0x53, 0x28, 0xd5, 0xc0,
    0xce, 0x2c, 0x91, 0x44, 0x2a, 0x7c, 0xbd, 0xcb,
    0x24, 0x45, 0xbe, 0x45, 0xbd, 0x34, 0x6c, 0xe2,
    0xd1, 0x0a, 0x59, 0x8e, 0x6c, 0x4e, 0x7b, 0x00};

static void buildKatMessage(uint32_t version, const uint8_t digest[32],
                            uint32_t intervalMs, uint8_t out[40]) {
  OtaManifest m;
  m.version = version;
  memcpy(m.sha256, digest, 32);
  m.intervalMs = intervalMs;
  buildOtaSignedMessage(m, out);
}

void ed25519_verifies_known_answer(void) {
  uint8_t msg[40];
  buildKatMessage(2, KAT_DIGEST, KAT_INTERVAL, msg);
  TEST_ASSERT_TRUE(Ed25519::verify(KAT_SIG, KAT_PUB, msg, sizeof(msg)));
}

void ed25519_rejects_tampered_digest(void) {
  uint8_t bad[32];
  memcpy(bad, KAT_DIGEST, 32);
  bad[0] ^= 0x01;
  uint8_t msg[40];
  buildKatMessage(2, bad, KAT_INTERVAL, msg);
  TEST_ASSERT_FALSE(Ed25519::verify(KAT_SIG, KAT_PUB, msg, sizeof(msg)));
}

void ed25519_rejects_wrong_version(void) {
  uint8_t msg[40];
  buildKatMessage(3, KAT_DIGEST, KAT_INTERVAL, msg);
  TEST_ASSERT_FALSE(Ed25519::verify(KAT_SIG, KAT_PUB, msg, sizeof(msg)));
}

// The cadence is inside the signature, so a manifest that keeps the version
// and digest but swaps the interval must not verify - that is what stops a
// captured manifest being replayed with a different upload rate.
void ed25519_rejects_tampered_interval(void) {
  uint8_t msg[40];
  buildKatMessage(2, KAT_DIGEST, KAT_INTERVAL + 1, msg);
  TEST_ASSERT_FALSE(Ed25519::verify(KAT_SIG, KAT_PUB, msg, sizeof(msg)));
}

// intervalMs is required: the signed message covers it, so a manifest
// without one cannot be verified at all.
static const char NO_INTERVAL[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

static const char WITH_INTERVAL[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"intervalMs\":600000,"
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

static const char INTERVAL_NOT_A_NUMBER[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"intervalMs\":\"600000\","
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

void rejects_manifest_without_interval(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(NO_INTERVAL, m));
}

void rejects_non_numeric_interval(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(INTERVAL_NOT_A_NUMBER, m));
}

void parses_interval(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(WITH_INTERVAL, m));
  TEST_ASSERT_EQUAL_UINT32(600000, m.intervalMs);
}

void interval_bounds(void) {
  TEST_ASSERT_FALSE(isAcceptableInterval(59999));
  TEST_ASSERT_TRUE(isAcceptableInterval(60000));
  TEST_ASSERT_TRUE(isAcceptableInterval(300000));
  TEST_ASSERT_TRUE(isAcceptableInterval(3600000));
  TEST_ASSERT_FALSE(isAcceptableInterval(3600001));
  TEST_ASSERT_FALSE(isAcceptableInterval(0));
}

// Layout is load-bearing: the release script signs these exact bytes, so a
// disagreement here means every device rejects every image.
void signed_message_layout(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(WITH_INTERVAL, m));

  uint8_t msg[40];
  buildOtaSignedMessage(m, msg);

  // version = 2, little endian
  TEST_ASSERT_EQUAL_UINT8(0x02, msg[0]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[1]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[2]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[3]);
  // digest
  TEST_ASSERT_EQUAL_UINT8(0xaa, msg[4]);
  TEST_ASSERT_EQUAL_UINT8(0x11, msg[35]);
  // intervalMs = 600000 = 0x000927C0, little endian
  TEST_ASSERT_EQUAL_UINT8(0xC0, msg[36]);
  TEST_ASSERT_EQUAL_UINT8(0x27, msg[37]);
  TEST_ASSERT_EQUAL_UINT8(0x09, msg[38]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[39]);
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
  RUN_TEST(ed25519_verifies_known_answer);
  RUN_TEST(ed25519_rejects_tampered_digest);
  RUN_TEST(ed25519_rejects_wrong_version);
  RUN_TEST(ed25519_rejects_tampered_interval);
  RUN_TEST(rejects_manifest_without_interval);
  RUN_TEST(rejects_non_numeric_interval);
  RUN_TEST(parses_interval);
  RUN_TEST(interval_bounds);
  RUN_TEST(signed_message_layout);
  return UNITY_END();
}
