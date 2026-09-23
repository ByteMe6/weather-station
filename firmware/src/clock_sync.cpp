#include "clock_sync.h"

#include <Arduino.h>
#include <time.h>

#include "wifi_link.h"

static bool clockValid = false;

// Anything past 2023 means NTP answered; the RTC starts at the epoch.
static const time_t CLOCK_SYNCED_EPOCH = 1700000000;

bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  // loop()'s own pollResetButton() call has already returned by the time
  // control reaches here (it runs before the wifiPhase switch, and syncClock()
  // is only ever reached from inside that switch), so this is a second poll
  // within the same iteration, not a reentrant call into one that's still on
  // the stack. It shrinks this function's up-to-10s blind window down to the
  // 250ms delay granularity, so a tap-and-release that happens entirely
  // inside the wait is not lost. pollResetButton() only touches the "wifi"
  // NVS namespace and, on a full hold, restarts - neither can call back into
  // syncClock(), so there is no recursion to worry about.
  while (time(nullptr) < CLOCK_SYNCED_EPOCH && millis() - start < 10000) {
    pollResetButton();
    delay(250);
  }
  clockValid = time(nullptr) >= CLOCK_SYNCED_EPOCH;
  return clockValid;
}

// Uploads depend on a valid clock for both the payload timestamp and TLS
// certificate validity, and syncClock() is allowed to time out at boot - so a
// device that came up before its router had internet has to recover somehow.
//
// It recovers on its own: configTime() ran at boot, and lwIP's SNTP client
// keeps retrying in the background after a failed request - 15s, doubling to a
// 150s ceiling (SNTP_RETRY_TIMEOUT/_MAX/_EXP in sntp_opts.h). That is more
// often than windows close, so this only has to observe the result. Calling
// the blocking syncClock() again here would stall loop() - and therefore the
// web portal and the sensor cadence - for up to 10s every window, and would
// also restart configTime() and throw away the backoff SNTP had built up.
bool ensureClock() {
  if (clockValid) return true;
  clockValid = time(nullptr) >= CLOCK_SYNCED_EPOCH;
  return clockValid;
}
