# MRP-13 — Firmware WiFi Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ESP32 firmware a captive-portal WiFi setup flow — AP + portal when no credentials are saved, NVS-backed persistence, indefinite backoff retry on join failure, and a 5s button hold to wipe credentials and return to setup.

**Architecture:** A `WifiPhase` state machine added to `src/main.cpp` drives `WiFiManager` (portal only, not `autoConnect()`) and `Preferences` (NVS) directly. Pure backoff/debounce math is extracted into a new Arduino-free `lib/wifi_state` module, unit-tested on the native host exactly like `lib/reading`. The existing BMP280 sensor loop is untouched and only runs once `STATION_CONNECTED`.

**Tech Stack:** PlatformIO + Arduino core (ESP32), `tzapu/WiFiManager@2.0.17` (already pinned), ESP32 `Preferences` (NVS, ships with the core), Unity (native host tests via `pio test -e native`).

---

## Global Constraints

- **Source of truth:** `docs/superpowers/specs/2026-07-23-mrp-13-firmware-wifi-provisioning-design.md`. If anything here conflicts with that spec, the spec wins — flag it rather than silently diverging.
- **No new `lib_deps`.** `WiFiManager` is already pinned in `platformio.ini`; `Preferences` ships with the ESP32 Arduino core. Do not touch `platformio.ini`.
- **Pattern to follow:** `lib/reading/reading.h` + `test/test_reading/test_reading.cpp` (Arduino-free header-only pure functions, Unity native tests with a hand-rolled `main()`). Match that style exactly for `lib/wifi_state`.
- **Commits:** message prefix `MRP-13:`. **Do not commit anything without explicit user approval** — per this project's CLAUDE.md ("Hold off on commits until functionality is fully implemented and tested") there is exactly one commit point in this plan (Task 5), and it only happens after the user has reviewed the diff and the on-device checklist has passed.
- **Run commands** from `/home/samedy/weather-station/firmware`.

---

### Task 1: `lib/wifi_state` — backoff and reset-hold pure logic

**Files:**
- Create: `lib/wifi_state/wifi_state.h`
- Test: `test/test_wifi_state/test_wifi_state.cpp`

**Interfaces:**
- `uint32_t nextBackoffMs(uint32_t attempt)` — attempt 1→5000, 2→10000, 3→30000, 4→60000, ≥5→60000 (cap holds). `attempt == 0` also returns 5000 (defensive; the caller never passes 0 in practice, but the function must not be undefined for it). *(Amended during implementation: parameter widened from `uint8_t` to `uint32_t` per code review — a forever-retrying caller's counter must not wrap the schedule; `LAST_INDEX` is derived from `sizeof(SCHEDULE)`; a 12th test pins the accepted not-held-across-millis()-wrap behavior.)*
- `bool isResetHeld(uint32_t pressStartMs, uint32_t nowMs, uint32_t holdMs = 5000)` — true once `nowMs - pressStartMs >= holdMs`; false (not underflow) if `nowMs < pressStartMs`.

- [ ] **Step 1: Write the failing test**

Create `test/test_wifi_state/test_wifi_state.cpp`:

```cpp
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

void reset_not_held_when_now_before_press_start(void) {
  // Defensive: must not underflow (pressStartMs - nowMs) and read as "held".
  TEST_ASSERT_FALSE(isResetHeld(5000, 1000, 5000));
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
  RUN_TEST(reset_not_held_when_now_before_press_start);
  RUN_TEST(reset_uses_default_hold_of_5s);
  return UNITY_END();
}
```

- [ ] **Step 2: Run the test suite to verify it fails**

Run: `pio test -e native -f test_wifi_state`
Expected: build **FAILS** — `fatal error: wifi_state.h: No such file or directory` (the header doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/wifi_state/wifi_state.h`:

```cpp
#pragma once
#include <stdint.h>

// Station-mode reconnect backoff: 5s -> 10s -> 30s -> 60s, then holds at 60s
// for every attempt beyond the 4th. The device never gives up and never
// falls back to opening the setup portal on its own.
inline uint32_t nextBackoffMs(uint8_t attempt) {
  static const uint32_t SCHEDULE[] = {5000, 10000, 30000, 60000};
  static const uint8_t LAST_INDEX = 3;

  uint8_t index = (attempt == 0) ? 0 : static_cast<uint8_t>(attempt - 1);
  if (index > LAST_INDEX) index = LAST_INDEX;
  return SCHEDULE[index];
}

// True once the button has been continuously held for >= holdMs. Pure
// timestamp comparison; the caller (main.cpp) is responsible for confirming
// the button has been continuously pressed (via digitalRead) before calling
// this on every loop() iteration.
inline bool isResetHeld(uint32_t pressStartMs, uint32_t nowMs, uint32_t holdMs = 5000) {
  if (nowMs < pressStartMs) return false;  // defensive: millis() wrap or bad input
  return (nowMs - pressStartMs) >= holdMs;
}
```

- [ ] **Step 4: Run the test suite to verify it passes**

Run: `pio test -e native -f test_wifi_state`
Expected: `11 Tests 0 Failures 0 Ignored` (PASS), alongside the pre-existing `test_reading` suite if run without the `-f` filter.

Also run the full native suite to confirm nothing else broke:
Run: `pio test -e native`
Expected: both `test_reading` and `test_wifi_state` report `PASSED`.

---

### Task 2: `src/main.cpp` — WiFi state machine

**Files:**
- Modify: `src/main.cpp` (full rewrite — the file is currently 59 lines; the block below is the complete new contents)

**Depends on:** Task 1 (`lib/wifi_state/wifi_state.h`)

- [ ] **Step 1: Replace `src/main.cpp` with the state-machine version**

Replace the entire contents of `src/main.cpp` with:

```cpp
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <Preferences.h>
#include <Adafruit_BMP280.h>
#include <reading.h>
#include <wifi_state.h>

// 0x76 on most GY-BMP280 breakouts, 0x77 on Adafruit boards.
static const uint8_t BMP_ADDR[] = {0x76, 0x77};
static const uint32_t READ_INTERVAL = 2000;
static const float SEA_LEVEL_HPA = 1013.25f;  // reference for derived altitude

static Adafruit_BMP280 bmp;
static bool ready = false;
static uint32_t lastRead = 0;

// Onboard BOOT button present on virtually every ESP32 dev board — active-low
// with an internal pull-up, no extra wiring needed. Held 5s wipes the saved
// WiFi credentials and returns the device to setup mode.
static const uint8_t RESET_BUTTON_PIN = 0;
static const uint32_t RESET_HOLD_MS = 5000;
static const uint32_t STATION_CONNECT_TIMEOUT_MS = 15000;

enum class WifiPhase {
  BOOT,
  SETUP_PORTAL,
  STATION_CONNECTING,
  STATION_CONNECTED,
};

static WifiPhase wifiPhase = WifiPhase::BOOT;
static Preferences wifiPrefs;
static String savedSsid;
static String savedPass;
static uint32_t connectAttempt = 0;
static uint32_t connectingSince = 0;
static uint32_t backoffDurationMs = 0;
static bool backingOff = false;
static uint32_t resetPressStart = 0;
static bool resetPressActive = false;

bool initSensor() {
  if (!bmp.begin(BMP_ADDR[0]) && !bmp.begin(BMP_ADDR[1])) return false;

  bmp.setSampling(Adafruit_BMP280::MODE_FORCED,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::SAMPLING_X1,
                  Adafruit_BMP280::FILTER_OFF);
  return true;
}

void loadWifiCredentials() {
  wifiPrefs.begin("wifi", true);
  savedSsid = wifiPrefs.getString("ssid", "");
  savedPass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
}

bool saveWifiCredentials(const String &ssid, const String &pass) {
  if (!wifiPrefs.begin("wifi", false)) return false;
  size_t ssidWritten = wifiPrefs.putString("ssid", ssid);
  size_t passWritten = wifiPrefs.putString("pass", pass);
  wifiPrefs.end();
  return ssidWritten == ssid.length() && passWritten == pass.length();
}

void clearWifiCredentials() {
  wifiPrefs.begin("wifi", false);
  wifiPrefs.clear();
  wifiPrefs.end();
}

void startSetupPortal() {
  Serial.println("No saved WiFi - starting setup portal");
  wifiPhase = WifiPhase::SETUP_PORTAL;

  String apName = String("WeatherStation-") + DEVICE_ID;

  bool credentialsSaved = false;
  while (!credentialsSaved) {
    WiFiManager wm;
    bool connected = wm.startConfigPortal(apName.c_str());
    if (!connected) {
      Serial.println("Setup portal closed without a connection, reopening");
      continue;
    }

    if (saveWifiCredentials(WiFi.SSID(), WiFi.psk())) {
      credentialsSaved = true;
    } else {
      Serial.println("Failed to save WiFi credentials to NVS, reopening portal");
    }
  }

  savedSsid = WiFi.SSID();
  savedPass = WiFi.psk();
  connectAttempt = 0;
  wifiPhase = WifiPhase::STATION_CONNECTED;
  Serial.println("WiFi credentials saved, connected");
}

void beginStationConnect() {
  Serial.printf("Connecting to %s (attempt %u)\n", savedSsid.c_str(), connectAttempt + 1);
  WiFi.begin(savedSsid.c_str(), savedPass.c_str());
  connectingSince = millis();
  backingOff = false;
  wifiPhase = WifiPhase::STATION_CONNECTING;
}

void handleStationConnecting() {
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    connectAttempt = 0;
    wifiPhase = WifiPhase::STATION_CONNECTED;
    return;
  }

  if (backingOff) {
    if (millis() - connectingSince >= backoffDurationMs) {
      beginStationConnect();
    }
    return;
  }

  if (millis() - connectingSince >= STATION_CONNECT_TIMEOUT_MS) {
    connectAttempt++;
    backoffDurationMs = nextBackoffMs(connectAttempt);
    Serial.printf("Connect attempt failed, retrying in %u ms\n", backoffDurationMs);
    WiFi.disconnect();
    connectingSince = millis();
    backingOff = true;
  }
}

void handleStationConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi dropped, reconnecting");
    beginStationConnect();
    return;
  }

  if (millis() - lastRead < READ_INTERVAL) return;
  lastRead = millis();

  if (!ready) {
    ready = initSensor();
    if (!ready) {
      Serial.println("BMP280 unavailable");
      return;
    }
  }

  bmp.takeForcedMeasurement();

  float t = bmp.readTemperature() - 1.1f;
  float p = bmp.readPressure() / 100.0f;

  if (!isPlausibleReading(t, p)) {
    Serial.println("BMP280 reading out of range, re-initialising");
    ready = false;
    return;
  }

  float alt = 44330.0f * (1.0f - powf(p / SEA_LEVEL_HPA, 0.1903f));

  Serial.printf("temp=%.2f C  pressure=%.1f hPa  altitude=%.1f m\n", t, p, alt);
}

void pollResetButton() {
  bool pressed = digitalRead(RESET_BUTTON_PIN) == LOW;

  if (!pressed) {
    resetPressActive = false;
    return;
  }

  if (!resetPressActive) {
    resetPressActive = true;
    resetPressStart = millis();
    return;
  }

  if (isResetHeld(resetPressStart, millis(), RESET_HOLD_MS)) {
    Serial.println("Reset button held 5s, wiping WiFi credentials");
    clearWifiCredentials();
    ESP.restart();
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);

  ready = initSensor();
  if (!ready) Serial.println("BMP280 not found, retrying...");

  loadWifiCredentials();
  if (savedSsid.length() == 0) {
    startSetupPortal();
  } else {
    beginStationConnect();
  }
}

void loop() {
  pollResetButton();

  switch (wifiPhase) {
    case WifiPhase::STATION_CONNECTING:
      handleStationConnecting();
      break;
    case WifiPhase::STATION_CONNECTED:
      handleStationConnected();
      break;
    case WifiPhase::SETUP_PORTAL:
    case WifiPhase::BOOT:
      break;
  }
}
```

- [ ] **Step 2: Build for the board to verify it compiles**

Run: `pio run`
Expected: `SUCCESS` — links `firmware.elf`/`firmware.bin` for `env:esp32dev` with no errors. (This does not require hardware to be connected — `pio run` without `--target upload` only compiles.)

- [ ] **Step 3: Confirm the native test suite is unaffected**

Run: `pio test -e native`
Expected: `test_reading` and `test_wifi_state` both still `PASSED` — `src/main.cpp` is not part of the native build (it has no `main()`; native tests are standalone executables with their own `main()`), so this step is a sanity check, not expected to catch anything new.

---

### Task 3: `README.md` — document the WiFi setup flow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "WiFi setup" section**

In `README.md`, insert a new section immediately after the existing `## Sensors — BMP280 (I2C)` section (i.e. right before `## Flash-time configuration`):

```markdown
## WiFi setup

The device ships with no WiFi configured — only identity (`DEVICE_ID` /
`DEVICE_SECRET`) is flashed at manufacture time.

**First boot (no saved credentials):** the device starts an access point
named `WeatherStation-<DEVICE_ID>`. Connecting to it with a phone
auto-opens a captive portal that lists nearby networks and accepts a
password. Once submitted, credentials are saved to NVS (flash) and survive
power loss.

**Subsequent boots:** the device connects directly in station mode using
the saved credentials — no portal.

**Join failure:** the device retries the saved network forever, with
increasing backoff between attempts. It never falls back to reopening the
portal on its own:

| Attempt | Backoff before retry |
| ------- | --------------------- |
| 1       | 5 s                    |
| 2       | 10 s                   |
| 3       | 30 s                   |
| 4+      | 60 s                   |

**Reset button:**

| Function     | Pin                    |
| ------------ | ----------------------- |
| Reset button | GPIO0 (onboard BOOT button, active-low) |

Holding it for 5 seconds wipes the saved WiFi credentials and restarts the
device back into setup mode (the access point above).
```

- [ ] **Step 2: Visually confirm the table renders correctly**

Run: `cat README.md` and check the new section by eye — table pipes aligned, no broken markdown, section sits between "Sensors — BMP280 (I2C)" and "Flash-time configuration" as in the rest of the file's existing structure.

---

### Task 4: Verification — automated + manual on-device checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated verification**

Run: `pio test -e native && pio run`
Expected: native suite fully green (`test_reading` + `test_wifi_state`), then `pio run` reports `SUCCESS` for `env:esp32dev`.

- [ ] **Step 2: Manual on-device checklist**

This requires physical hardware (ESP32 + BMP280 wired per the README, flashed with `pio run --target upload`, monitored with `pio device monitor`) and a phone. Walk through each item and record pass/fail — these map directly to the MRP-13 acceptance criteria and cannot be automated:

- [ ] Fresh device (NVS `"wifi"` namespace empty/erased) boots and appears as WiFi access point `WeatherStation-<DEVICE_ID>`.
- [ ] Connecting to that AP with a phone auto-opens the captive portal; it lists nearby networks and accepts a password for one of them.
- [ ] After submitting credentials, the device connects and serial log shows `"WiFi credentials saved, connected"`.
- [ ] Power-cycle the device (unplug/replug). On reboot it connects directly in station mode — no portal, no AP — and serial log shows `"WiFi connected"` without a `"starting setup portal"` line.
- [ ] Simulate a join failure (e.g. power off the router, or temporarily block the device's MAC). Serial log shows repeated `"Connect attempt failed, retrying in ..."` lines following the 5000 → 10000 → 30000 → 60000 (ms) sequence, holding at 60000 for further attempts, indefinitely — and the device never reopens the portal or reboots into AP mode on its own.
- [ ] Restore network access — device reconnects on its own within one backoff cycle, resuming BMP280 serial logging (`temp=... pressure=... altitude=...`).
- [ ] Hold the onboard BOOT button (GPIO0) for 5 seconds. Serial log shows `"Reset button held 5s, wiping WiFi credentials"`, device restarts, and comes back up broadcasting `WeatherStation-<DEVICE_ID>` again (back to first-boot state).
- [ ] Full setup flow end-to-end against a real, fresh WiFi network on a phone (the ticket's explicit acceptance criterion) — portal → credentials → connected → BMP280 readings logging.

- [ ] **Step 3: Report results**

Summarize which checklist items passed/failed back to the user before proceeding to Task 5. Any failure means returning to Task 2 to fix the state machine — do not proceed to commit with a failing checklist item.

---

### Task 5: Commit (only after explicit user approval)

**Files:** all files touched in Tasks 1–3

**Do not run this task's commands until:**
1. Task 4's automated verification is green, **and**
2. Task 4's manual on-device checklist has been walked through and reported, **and**
3. The user has explicitly said to commit.

- [ ] **Step 1: Review the diff**

Run: `git status && git diff --stat`
Expected: shows `lib/wifi_state/wifi_state.h`, `test/test_wifi_state/test_wifi_state.cpp`, `src/main.cpp`, `README.md` as the only changes.

- [ ] **Step 2: Stage and commit**

```bash
git add lib/wifi_state/wifi_state.h test/test_wifi_state/test_wifi_state.cpp src/main.cpp README.md
git commit -m "$(cat <<'EOF'
MRP-13: captive-portal WiFi provisioning, NVS storage, reset button

Add a WifiPhase state machine to main.cpp: WiFiManager drives the initial
setup portal only (never autoConnect's automatic portal-on-failure
fallback), credentials persist via Preferences (NVS), and station-mode
join failures retry forever with 5s/10s/30s/60s backoff. Holding the
onboard BOOT button (GPIO0) 5s wipes saved credentials and returns to
setup. Backoff and button-hold logic extracted into host-testable
lib/wifi_state, following the lib/reading pattern from MRP-11.
EOF
)"
git status
```

Expected: commit succeeds; `git status` shows a clean working tree on branch `mrp-13-firmware-captive-portal-WiFi-provisioning-NVS-storage-reset-button`.
