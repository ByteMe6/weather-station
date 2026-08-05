# MRP-13 — Firmware: captive-portal WiFi provisioning, NVS storage, reset button

- **Ticket**: [MRP-13](https://linear.app/mrplit/issue/MRP-13) (High, Firmware, Phase 1)
- **Branch**: `mrp-13-firmware-captive-portal-WiFi-provisioning-NVS-storage-reset-button`
- **Date**: 2026-07-23
- **References**: `docs/04-prd.md` (F7), `docs/05-architecture-and-tech-stack.md` (Device WiFi
  Connection flowchart)

## Summary

The device ships with no WiFi configured — only identity (`DEVICE_ID` /
`DEVICE_SECRET`) is flashed at manufacture time. This ticket adds the
customer-facing setup flow: boot as an access point when no credentials are
saved, run a captive portal (network list + password entry) to collect them,
persist to NVS, and join the home network directly on every later boot. A
physical button held 5s wipes the saved credentials and returns to setup mode.
Sending readings to the backend is **out of scope** — this ticket only gets
the device onto the network.

## What this ticket does NOT touch

- No HTTP client / `POST /api/v1/readings` integration (separate ticket,
  MRP-15 per the MRP-12 spec's forward reference).
- No BME280 swap (still BMP280 from MRP-11).
- No new reset-button hardware — the onboard **GPIO0 (BOOT) button**, already
  present on every ESP32 dev board, is reused. No wiring changes.

## Prior art / current state

- `src/main.cpp` (MRP-11): `setup()`/`loop()` sample the BMP280 every 2s and
  log to serial. No networking, no state machine.
- `lib/reading/reading.h` + `test/test_reading/test_reading.cpp`: the
  established pattern — Arduino-free pure logic in `lib/`, covered by native
  Unity tests (`pio test -e native`), run in firmware CI alongside `pio run`.
- `platformio.ini` already pins `tzapu/WiFiManager@2.0.17` as a `lib_dep`
  (added in MRP-11 scaffolding, unused until now).
- `DEVICE_ID` is a flash-time build flag from `secrets.ini` (`-DDEVICE_ID=...`).

## Design decisions (resolved)

| Decision | Choice |
| --- | --- |
| Captive portal library | `WiFiManager`, used **only** for the initial setup portal (`startConfigPortal`) — not `autoConnect()` |
| Credential storage | Explicit ESP32 `Preferences` (NVS), namespace `"wifi"`, keys `ssid`/`pass` — not WiFiManager's own persistence |
| Post-setup join failures | Retry **forever** in station mode with capped backoff; **never** auto-reopen the portal |
| Backoff sequence | 5s → 10s → 30s → 60s, then holds at 60s for all further attempts |
| Setup portal blocking behavior | Blocking (`startConfigPortal` halts `loop()`) — acceptable since there's no network yet for the sensor loop to use anyway |
| Reset trigger | GPIO0 (BOOT button), active-low, held continuously ≥5s |
| Reset action | Clear NVS `"wifi"` namespace, then `ESP.restart()` (clean reboot back into `BOOT` → `SETUP_PORTAL`, rather than tearing down WiFiManager/WiFi mid-loop) |
| Per-attempt connect timeout | 15s (`WiFi.status()` polled non-blocking until `WL_CONNECTED` or 15s elapses, then counted as a failed attempt) |
| New testable logic | `lib/wifi_state/wifi_state.h` — pure backoff and button-hold-duration functions, covered by `test/test_wifi_state/`, following the `lib/reading` pattern |

## State machine

```
BOOT
  read WiFi creds from NVS (Preferences, namespace "wifi")
    no creds  → SETUP_PORTAL
    has creds → STATION_CONNECTING

SETUP_PORTAL
  WiFiManager.startConfigPortal("WeatherStation-<DEVICE_ID>")   [blocking]
  on submit → save ssid/pass to NVS → STATION_CONNECTING

STATION_CONNECTING
  WiFi.begin(ssid, pass); poll WiFi.status() non-blocking up to 15s
    success (WL_CONNECTED within 15s) → STATION_CONNECTED (reset attempt counter to 0)
    15s elapses without connecting → attempt++; sleep nextBackoffMs(attempt)
                   [non-blocking, millis()-based]; retry STATION_CONNECTING — forever

STATION_CONNECTED
  normal operation: existing BMP280 loop runs unchanged
  WiFi.status() != WL_CONNECTED at any point → STATION_CONNECTING

(checked every loop() iteration, independent of WiFi state)
RESET BUTTON (GPIO0) held continuously ≥5s
  → Preferences("wifi").clear() → ESP.restart()
```

Restart-on-reset (rather than in-place state transition) keeps the machine
simple and matches the existing fault-recovery style (BMP280 re-init on a bad
reading is also a "reset to a known state," not an attempt to preserve
mid-flight state).

## Components

### `lib/wifi_state/wifi_state.h` (new, Arduino-free)

```cpp
#pragma once
#include <stdint.h>

// 5s -> 10s -> 30s -> 60s, capped at 60s for attempt >= 4.
uint32_t nextBackoffMs(uint8_t attempt);

// True once the button has been continuously held for >= holdMs.
// Pure timestamp comparison; main.cpp is responsible for confirming
// continuous-low (debounce) before calling this.
bool isResetHeld(uint32_t pressStartMs, uint32_t nowMs, uint32_t holdMs = 5000);
```

### `src/main.cpp` (modified)

- Adds: `WiFiManager`, `Preferences`, a `WifiPhase` enum
  (`BOOT`/`SETUP_PORTAL`/`STATION_CONNECTING`/`STATION_CONNECTED`), GPIO0
  polling for the reset button, and the backoff/retry loop using
  `wifi_state.h`.
- Unchanged: the BMP280 `initSensor()`/read loop — runs identically once in
  `STATION_CONNECTED`, and (per the blocking-portal decision) simply doesn't
  run during `SETUP_PORTAL` since `startConfigPortal()` blocks.
- AP name: `"WeatherStation-" + String(DEVICE_ID)`.

### `README.md` (modified)

Add a "WiFi setup" section documenting: AP name format, GPIO0/BOOT as the
reset button (table style matching the existing BMP280 pin table), and the
backoff sequence.

## Data flow

`Preferences` (NVS) is the single source of truth for saved credentials —
WiFiManager's own persistence layer is irrelevant here since `autoConnect()`
is never called. `DEVICE_ID` (existing build flag) feeds the AP name string.

## Error handling

- BMP280 fault recovery (existing, MRP-11) is untouched and orthogonal to
  WiFi state — it re-inits independently regardless of `WifiPhase`.
- Station join failures never brick the device: they loop
  `STATION_CONNECTING` with capped backoff indefinitely.
- `Preferences` write failure during setup (out of NVS space, etc.) is logged
  and the portal is re-shown rather than silently proceeding as if
  credentials were saved.

## Testing

### Native unit (`test/test_wifi_state/`, `pio test -e native`)

Mirrors `test_reading.cpp` exactly in style:

- `nextBackoffMs`: attempt 1→5000, 2→10000, 3→30000, 4→60000, 5 and beyond
  →60000 (cap holds).
- `isResetHeld`: false before `holdMs` elapsed, true at exactly `holdMs`, true
  well beyond `holdMs`, false for a `nowMs` before `pressStartMs` (defensive
  boundary — should not happen in practice but must not underflow/return
  true).

### Manual (on-device, per the ticket's own acceptance criteria)

- Fresh device (no creds) boots as `WeatherStation-<id>` AP; captive portal
  auto-opens on phone connect; lists nearby networks; accepts a password.
- Credentials survive a power cycle; device joins station mode directly on
  reboot.
- Simulated join failure (wrong password re-saved, or router off) shows the
  5s→10s→30s→60s backoff in serial log, retries indefinitely, never reopens
  the portal.
- Holding GPIO0 5s wipes credentials and returns to AP/setup mode.
- Full flow verified against a real phone + fresh WiFi network (the ticket's
  explicit AC).

## Dependency & config changes (`firmware`)

- No new `lib_deps` — `WiFiManager` already pinned; `Preferences` ships with
  the ESP32 Arduino core.
- `platformio.ini`: no changes needed (native env already exists from MRP-11).

## Build sequence

1. `lib/wifi_state/wifi_state.h` (`nextBackoffMs`, `isResetHeld`) +
   `test/test_wifi_state/test_wifi_state.cpp`.
2. `src/main.cpp`: `WifiPhase` state machine, `Preferences`-backed NVS
   read/save/clear, `SETUP_PORTAL` via `WiFiManager::startConfigPortal`,
   `STATION_CONNECTING`/`STATION_CONNECTED` transitions, GPIO0 reset polling.
3. `README.md`: WiFi setup section.
4. `pio test -e native && pio run`; manual on-device verification per
   §Testing.

## Implementation amendments (2026-07-23)

Recorded during implementation review; these supersede the corresponding
text above.

- **Portal exit lands in `STATION_CONNECTED`, not `STATION_CONNECTING`.**
  When `startConfigPortal()` returns true the STA is already associated, so
  re-running `WiFi.begin()` would be redundant; a drop right after is caught
  by the connected-phase status check on the next `loop()`.
- **`nextBackoffMs` takes `uint32_t`** (not `uint8_t`) so a forever-retrying
  counter can never wrap the schedule; `LAST_INDEX` is derived from
  `sizeof(SCHEDULE)`.
- **`isResetHeld` is plain unsigned subtraction** — the defensive
  `nowMs < pressStartMs` guard was removed as strictly worse: unsigned
  subtraction already yields true elapsed time across a `millis()` wrap, so
  a wrap-straddling hold triggers on schedule (pinned by test).
- **Restart waits for button release.** GPIO0 is a strap pin; restarting
  while it is still held would drop the ROM into UART download mode. After
  wiping credentials the firmware blocks until release, then `ESP.restart()`.
- **Empty-SSID portal race guarded.** `WiFi.SSID()` returns `""` if the AP
  drops immediately after the portal joins; that would save blank creds and
  wedge station mode. The portal reopens instead of saving an empty SSID.
- **`WiFi.setAutoReconnect(false)` at boot.** The core's auto-reconnect
  would otherwise retry inside the backoff window, making the 5/10/30/60s
  schedule advisory rather than authoritative. (Verified WiFiManager 2.0.17
  does not re-enable it on ESP32.)

## Riding along (out-of-AC extras, added at the maintainer's request 2026-07-23)

Beyond the ticket's acceptance criteria, same-branch extras (precedent: MRP-12
health/docs endpoints):

- **Station-mode web portal.** After connecting, the same WiFiManager portal
  stays reachable at the device's LAN IP (`wm.startWebPortal()` +
  `process()` each loop in `STATION_CONNECTED`; stopped on drop). The IP is
  printed to serial on connect. Menu: wifi / info / restart. Anyone on the
  home LAN can reach it — accepted for MVP (matches the maintainer's "same
  page" choice).
- **NVS sync on portal-initiated network change.** WiFiManager's
  `setSaveConfigCallback` fires after a successful web-portal reconnect; the
  handler persists the new SSID/psk to NVS (with the same empty-SSID guard),
  so reboots follow the newly chosen network. A failed change recovers via
  the normal state machine using the still-saved old credentials.
- **Portal restyle.** Shared CSS injected via `setCustomHeadElement` +
  `setTitle("Weather Station")` for both the setup captive portal and the
  station-mode portal: system font stack, card layout, single blue accent,
  rounded inputs/buttons. Deliberately restrained — no gradients or theme
  gimmicks. WiFiManager markup/logic untouched.

## Acceptance criteria mapping

- Boots as AP `WeatherStation-<id>` with no saved creds → §State machine,
  `SETUP_PORTAL`.
- Captive portal lists networks + accepts password → `WiFiManager.startConfigPortal`.
- Credentials survive power loss; station mode on later boots → `Preferences`
  NVS storage, §Data flow.
- Join failure retries with 5s→10s→30s→60s backoff, forever, never bricks →
  `STATION_CONNECTING` loop + `nextBackoffMs`.
- Reset button (5s hold) wipes creds, returns to AP/setup → GPIO0 polling +
  `isResetHeld` + `Preferences.clear()` + `ESP.restart()`.
- Full flow verified on a phone against a fresh network → §Testing, Manual.
