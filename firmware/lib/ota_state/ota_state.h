#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <ArduinoJson.h>

// Parsed manifest.json. sha256 is the digest of the .bin; sig is the
// Ed25519 signature over version (4 bytes LE) + that digest + intervalMs
// (4 bytes LE), so neither a replayed old image nor an altered cadence can
// be passed off under a newer version number.
struct OtaManifest {
  uint32_t version;
  char path[96];
  uint32_t size;
  uint8_t sha256[32];
  uint32_t intervalMs;
  uint8_t sig[64];
};

// Update only when the offered version is strictly newer.
inline bool isNewerVersion(uint32_t current, uint32_t offered) {
  return offered > current;
}

// Bounds on the remotely-set upload cadence. Below the floor the fleet would
// hammer the backend; above the ceiling data collection quietly stops. Both
// are one typo away in the release script, so a value outside this range is
// refused rather than clamped silently to an edge - a refusal is visible in
// the log, a silent clamp is not.
static const uint32_t OTA_INTERVAL_MIN_MS = 60000;
static const uint32_t OTA_INTERVAL_MAX_MS = 3600000;

inline bool isAcceptableInterval(uint32_t ms) {
  return ms >= OTA_INTERVAL_MIN_MS && ms <= OTA_INTERVAL_MAX_MS;
}

// The exact bytes ota_release.py signs. Keep the two in lockstep: a
// disagreement here rejects every image on every device, and the only
// symptom is "bad signature".
inline void buildOtaSignedMessage(const OtaManifest &m, uint8_t out[40]) {
  out[0] = (uint8_t)m.version;
  out[1] = (uint8_t)(m.version >> 8);
  out[2] = (uint8_t)(m.version >> 16);
  out[3] = (uint8_t)(m.version >> 24);
  memcpy(out + 4, m.sha256, 32);
  out[36] = (uint8_t)m.intervalMs;
  out[37] = (uint8_t)(m.intervalMs >> 8);
  out[38] = (uint8_t)(m.intervalMs >> 16);
  out[39] = (uint8_t)(m.intervalMs >> 24);
}

inline int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Strict: input must be exactly 2*outLen hex chars.
inline bool decodeHex(const char *s, uint8_t *out, size_t outLen) {
  if (strlen(s) != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexNibble(s[i * 2]);
    int lo = hexNibble(s[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

inline int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

// Strict: standard base64 with padding, must decode to exactly outLen bytes.
inline bool decodeBase64(const char *s, uint8_t *out, size_t outLen) {
  size_t len = strlen(s);
  if (len == 0 || len % 4 != 0) return false;

  size_t pad = 0;
  if (s[len - 1] == '=') pad++;
  if (pad && s[len - 2] == '=') pad++;
  if (len / 4 * 3 - pad != outLen) return false;

  size_t o = 0;
  for (size_t i = 0; i < len; i += 4) {
    bool lastGroup = (i + 4 == len);
    int v[4];
    for (int j = 0; j < 4; j++) {
      char c = s[i + j];
      if (c == '=') {
        // '=' only in the last group, only positions 2/3, no data after it
        if (!lastGroup || j < 2) return false;
        if (j == 2 && s[i + 3] != '=') return false;
        v[j] = 0;
      } else {
        v[j] = base64Value(c);
        if (v[j] < 0) return false;
      }
    }
    uint32_t triple = ((uint32_t)v[0] << 18) | ((uint32_t)v[1] << 12) |
                      ((uint32_t)v[2] << 6) | (uint32_t)v[3];
    out[o++] = (uint8_t)(triple >> 16);
    if (!(lastGroup && pad >= 2)) out[o++] = (uint8_t)(triple >> 8);
    if (!(lastGroup && pad >= 1)) out[o++] = (uint8_t)triple;
  }
  return o == outLen;
}

inline bool parseManifest(const char *json, OtaManifest &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) return false;

  if (!doc["version"].is<uint32_t>() || !doc["path"].is<const char *>() ||
      !doc["size"].is<uint32_t>() || !doc["sha256"].is<const char *>() ||
      !doc["intervalMs"].is<uint32_t>() || !doc["sig"].is<const char *>())
    return false;

  out.version = doc["version"].as<uint32_t>();
  out.intervalMs = doc["intervalMs"].as<uint32_t>();
  out.size = doc["size"].as<uint32_t>();
  if (out.size == 0) return false;

  const char *path = doc["path"].as<const char *>();
  if (strlen(path) == 0 || strlen(path) >= sizeof(out.path)) return false;
  strncpy(out.path, path, sizeof(out.path));

  if (!decodeHex(doc["sha256"].as<const char *>(), out.sha256, sizeof(out.sha256)))
    return false;
  if (!decodeBase64(doc["sig"].as<const char *>(), out.sig, sizeof(out.sig)))
    return false;
  return true;
}
