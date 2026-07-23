#pragma once
#include <stdint.h>

// Reconnect backoff: 5s, 10s, 30s, then 60s forever.
inline uint32_t nextBackoffMs(uint32_t attempt) {
  static const uint32_t SCHEDULE[] = {5000, 10000, 30000, 60000};
  static const uint32_t LAST_INDEX = sizeof(SCHEDULE) / sizeof(SCHEDULE[0]) - 1;

  uint32_t index = (attempt == 0) ? 0 : attempt - 1;
  if (index > LAST_INDEX) index = LAST_INDEX;
  return SCHEDULE[index];
}

// True once the button has been down for holdMs. The caller tracks whether
// the press is continuous; unsigned math stays correct across a millis() wrap.
inline bool isResetHeld(uint32_t pressStartMs, uint32_t nowMs, uint32_t holdMs = 5000) {
  return (nowMs - pressStartMs) >= holdMs;
}
