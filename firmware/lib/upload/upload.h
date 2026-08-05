#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include <time.h>
#include <ArduinoJson.h>
#include <SHA256.h>

// "2026-08-04T12:00:00Z" - 20 characters plus a terminator, so outLen must be
// at least 21. zod's .datetime() on the backend rejects anything else.
inline bool formatIso8601Utc(int64_t epochSeconds, char *out, size_t outLen) {
  if (out == NULL || outLen < 21) return false;
  // ESP32's time_t is 32-bit signed: past 2038 the narrowing cast below wraps
  // to a different valid timestamp and gmtime_r returns a plausible wrong date
  // that passes every downstream check. Refuse instead.
  //
  // Below epoch zero is rejected too: a live sensor reading timestamped before
  // 1970 doesn't mean the reading is old, it means the device's clock hasn't
  // been set (or has been corrupted) - the value round-trips fine, but signing
  // and uploading it would just record a bogus timestamp as if it were real.
  if (epochSeconds < 0 || epochSeconds > INT32_MAX) return false;
  time_t t = (time_t)epochSeconds;
  struct tm utc;
  if (gmtime_r(&t, &utc) == NULL) return false;
  return strftime(out, outLen, "%Y-%m-%dT%H:%M:%SZ", &utc) == 20;
}

// Serializes the ReadingPayload contract. Returns the body length, or 0 if the
// payload could not be produced.
//
// The numbers are pre-formatted with snprintf and inserted as raw JSON rather
// than handed to ArduinoJson as floats: the signature is computed over these
// exact bytes, so the output has to be byte-identical every time and must not
// depend on the library's float-rendering choices.
//
// humidity is always null - the BMP280 has no humidity sensor - as are the
// wind and precipitation fields, which have no hardware at all yet.
inline size_t buildReadingBody(const char *isoTimestamp, float temperature,
                               float pressure, char *out, size_t outLen) {
  if (!isfinite(temperature) || !isfinite(pressure)) return 0;

  char temperatureText[16];
  char pressureText[16];
  // snprintf truncates silently rather than failing; buildReadingBody does
  // not itself enforce the BMP280 plausibility range, so an ungated caller
  // could otherwise sign and store a truncated, numerically wrong reading.
  int temperatureLen = snprintf(temperatureText, sizeof(temperatureText), "%.2f", temperature);
  int pressureLen = snprintf(pressureText, sizeof(pressureText), "%.2f", pressure);
  if (temperatureLen < 0 || (size_t)temperatureLen >= sizeof(temperatureText)) return 0;
  if (pressureLen < 0 || (size_t)pressureLen >= sizeof(pressureText)) return 0;

  JsonDocument doc;
  doc["timestamp"] = isoTimestamp;
  // serialized() stores a pointer into temperatureText/pressureText, not a
  // copy - both buffers must stay alive until serializeJson runs below.
  doc["temperature"] = serialized(temperatureText);
  doc["humidity"] = nullptr;
  doc["pressure"] = serialized(pressureText);
  doc["windSpeed"] = nullptr;
  doc["windDirection"] = nullptr;
  doc["precipitation"] = nullptr;

  // measureJson doesn't count the terminator serializeJson writes, so the
  // buffer needs room for it too - checked up front rather than relying on
  // serializeJson's silent truncation, which would produce invalid JSON that
  // still "succeeds" from the caller's point of view.
  if (measureJson(doc) + 1 > outLen) return 0;
  return serializeJson(doc, out, outLen);
}

// Lowercase-hex HMAC-SHA256 over "<timestampMs>.<body>", keyed with the device
// secret as raw text. This mirrors apps/web/src/lib/ingest/verify-signature.ts
// exactly; the 64-character hex secret is the key as-is, never hex-decoded.
// outLen must be at least 65 (64 hex characters plus the terminator).
inline bool signPayload(const char *secret, const char *timestampMs,
                        const char *body, char *outHex, size_t outLen) {
  if (secret == NULL || timestampMs == NULL || body == NULL) return false;
  if (outHex == NULL || outLen < 65) return false;

  const size_t secretLen = strlen(secret);
  SHA256 hash;
  hash.resetHMAC(secret, secretLen);
  hash.update(timestampMs, strlen(timestampMs));
  hash.update(".", 1);
  hash.update(body, strlen(body));

  uint8_t digest[32];
  hash.finalizeHMAC(secret, secretLen, digest, sizeof(digest));

  // Not named HEX: Arduino's Print.h defines that as a macro, so any translation
  // unit including Arduino.h before this header would fail to compile.
  static const char HEX_DIGITS[] = "0123456789abcdef";
  for (size_t i = 0; i < sizeof(digest); i++) {
    outHex[i * 2] = HEX_DIGITS[digest[i] >> 4];
    outHex[i * 2 + 1] = HEX_DIGITS[digest[i] & 0x0f];
  }
  outHex[64] = '\0';
  return true;
}

// HTTPClient reports transport-level failures as negative codes. Those and 5xx
// are worth another attempt; a 4xx will be rejected identically every time, so
// retrying it just spends the reading's remaining attempts for nothing.
inline bool shouldRetryUpload(int httpCode) {
  if (httpCode <= 0) return true;
  return httpCode >= 500 && httpCode <= 599;
}
