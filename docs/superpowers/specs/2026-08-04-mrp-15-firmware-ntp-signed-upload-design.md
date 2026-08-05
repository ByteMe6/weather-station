# MRP-15 — Firmware: NTP sync + signed HTTPS upload loop with retry/drop policy

- **Ticket**: [MRP-15](https://linear.app/mrplit/issue/MRP-15) (High, Firmware, Phase 1)
- **Branch**: `mrp-15-firmware-ntp-sync-signed-https-upload-loop-with-retry-drop-policy`
- **Base**: `origin/dev` (MRP-14 merged via PR #14)
- **Date**: 2026-08-04
- **References**: `docs/04-prd.md` (F5, F6, OQ2, OQ6),
  `docs/research/02-sampling-rate.md`,
  `docs/05-architecture-and-tech-stack.md` (normal operation loop)

## Summary

MRP-13 got the device onto the network; MRP-14 gave it signed OTA. This ticket
closes the data path: once connected, the firmware keeps the clock synced via
NTP, averages BMP280 samples over a 5-minute window, signs the payload with the
flashed `DEVICE_SECRET`, and POSTs it to `/api/v1/readings` over HTTPS with real
certificate verification. A reading that cannot be delivered in 3 attempts is
dropped — no buffering (PRD OQ2).

## What this ticket does NOT touch

- No local buffering (LittleFS ring of unsent readings) — explicitly post-MVP
  per PRD OQ2.
- No BME280 swap, no wind/precipitation sensors — those fields are sent as
  `null`.
- The OTA download path keeps `setInsecure()`. Image authenticity there comes
  from the Ed25519 signature over version + digest (MRP-14), not from TLS; that
  was a deliberate decision and re-litigating it is out of scope.
- No change to the ingest route's auth logic (MRP-12) beyond the humidity
  nullability described below.

## Prior art / current state

- `src/main.cpp` runs a `WifiPhase` state machine (`BOOT` / `SETUP_PORTAL` /
  `STATION_CONNECTING` / `STATION_CONNECTED`), a LAN-reachable WiFiManager web
  portal in the connected phase, a GPIO0 reset button, and a 2-second BMP280
  read loop that logs to serial.
- `syncClock()` already exists (MRP-14) but is called exactly once per boot,
  purely to make the OTA check work.
- The ingest contract is fixed by MRP-12: `apps/web/src/lib/ingest/verify-signature.ts`
  computes `HMAC-SHA256(secret, "${timestamp}.${rawBody}")` with the secret used
  as UTF-8 text, and compares against a lowercase-hex `x-signature`.
- `insertReading` already upserts with `onConflict: 'device_id,timestamp',
  ignoreDuplicates: true`, so a retry that re-sends an already-ingested reading
  is a harmless no-op.
- House pattern for testable logic: header-only, Arduino-free modules in `lib/`
  with native Unity tests (`lib/reading`, `lib/wifi_state`, `lib/ota_state`).
- The `native` env resolves both `ArduinoJson` and `rweather/Crypto`
  (`lib_compat_mode = off`), and `SHA256` exposes `resetHMAC`/`finalizeHMAC` —
  so payload building *and* signing are testable on the host, not just on
  device.

## Design decisions (resolved with the maintainer)

| Decision | Choice |
| --- | --- |
| What gets sent | **Mean** of the 2-second samples over the upload window (WMO ≥5-minute averaging, `docs/research/02-sampling-rate.md`) — not an instantaneous spot reading |
| Humidity | BMP280 has no humidity sensor → send `null`; the backend column and schema become nullable (see §Backend changes) |
| Pressure | Measured station pressure as read from the sensor, **not** normalized to sea level — normalization needs a trusted station altitude and belongs in the web layer |
| TLS trust | `setCACert()` with a single embedded **ISRG Root X1** PEM (~2 KB). Vercel issues via Let's Encrypt; the root is self-signed and valid until 2035-06-04, SHA-256 fingerprint `96:BC:EC:06:…:BD:DF:08:C6` (verified against the local trust store, not transcribed from memory) |
| Why not a cert bundle | `setCACertBundle()` exists in core 2.0.17, but PlatformIO/Arduino has no first-class way to generate or embed the blob — it needs ESP-IDF's `gen_crt_bundle.py` run by hand, a binary committed to git, `board_build.embed_files`, and linker-symbol plumbing in CI. Not worth it for one fixed domain when OTA can rotate a PEM in the field |
| Retry policy | At most **3 attempts** per reading — the initial POST plus two retries, spaced 10 s then 30 s — after which the reading is dropped. The ticket's "retried 3× then dropped" is read as three deliveries attempted in total, not four |
| What is retried | Transport errors, timeouts, and 5xx only. `4xx` is terminal — a bad signature or a rejected payload will not fix itself, so it is logged and dropped without burning attempts |
| Endpoint address | Stored in NVS, editable from the existing LAN web portal; falls back to the flash-time `API_URL` build flag when NVS is empty |
| Clock | The existing `syncClock()` call on first connect (added by MRP-14 for the OTA check) is kept and becomes load-bearing for uploads too; the ESP32 SNTP client re-syncs periodically on its own afterwards. Uploads are skipped while the clock is not yet valid |

## Architecture

### New pure modules (`lib/`, Arduino-free, native-tested)

#### `lib/aggregate/aggregate.h`

Accumulates samples over one upload window.

```cpp
struct SampleAccumulator {
  uint32_t count;
  double temperatureSum;
  double pressureSum;
};

inline void accumulatorReset(SampleAccumulator &a);
inline void accumulatorAdd(SampleAccumulator &a, float temperature, float pressure);
inline bool accumulatorMean(const SampleAccumulator &a, float &temperature, float &pressure);
```

`accumulatorMean` returns false when `count == 0` so an empty window can never
produce a division by zero or a fabricated reading. Sums are `double` so a long
window cannot accumulate meaningful float error.

#### `lib/upload/upload.h`

```cpp
// "2026-08-04T12:00:00Z" from a Unix epoch in seconds. Buffer must be >= 21.
inline bool formatIso8601Utc(int64_t epochSeconds, char *out, size_t outLen);

// Serializes the ReadingPayload contract. Absent sensors are emitted as JSON
// null, matching the backend schema.
inline size_t buildReadingBody(const char *isoTimestamp, float temperature,
                               float pressure, char *out, size_t outLen);

// Lowercase-hex HMAC-SHA256 over "<timestampMs>.<body>", keyed with the device
// secret as raw text. Mirrors apps/web/src/lib/ingest/verify-signature.ts.
inline bool signPayload(const char *secret, const char *timestampMs,
                        const char *body, char *outHex, size_t outLen);

// Transport failures and 5xx are worth another attempt; 4xx never is.
inline bool shouldRetryUpload(int httpCode);
```

`shouldRetryUpload` takes the `HTTPClient` convention where a negative code
means a transport-level failure.

### `src/main.cpp` (modified)

Adds an upload sub-state machine that runs inside `STATION_CONNECTED`, next to
the existing sensor loop and web-portal `process()` call:

```
STATION_CONNECTED, every loop():
  every READ_INTERVAL (2 s): read sensor -> accumulatorAdd

  window closed (millis() - windowStart >= SEND_INTERVAL_MS):
    clock valid?  no  -> log, reset window, drop
    accumulatorMean? no -> log "no samples", reset window, drop
    yes -> capture timestamp + mean, build body, sign, attempt 1

  upload pending, attempt due:
    POST over WiFiClientSecure (setCACert)
      2xx                       -> success, clear pending
      shouldRetryUpload && more -> schedule next attempt (+10 s, then +30 s)
      otherwise                 -> log reason, drop reading
```

The window keeps accumulating while an upload is pending: the retry schedule
(worst case ~40 s plus request time) always finishes well inside the 5-minute
window, so a pending reading and a newly closed window never collide. If a
window somehow closes while an upload is still pending, the older reading is
dropped rather than queued — consistent with the no-buffering decision.

WiFi loss during an upload is handled by the existing phase check: the pending
reading is discarded, the accumulator is reset, and the machine falls into
`STATION_CONNECTING` with its established backoff. No reboot.

### Endpoint configuration

`resolveApiUrl()` reads namespace `"cfg"`, key `"apiurl"` from NVS and falls
back to the compile-time `API_URL` when it is empty. The station-mode web portal
gains one `WiFiManagerParameter` for the URL, persisted in the existing save
callback. This keeps a local-versus-production switch to a phone visit instead
of a reflash, which is what the maintainer asked for.

`secrets.ini.example` currently documents `/api/readings`; the real route is
`/api/v1/readings` (`READINGS_INGEST_PATH` in `@ws/shared`). That is corrected
here.

### TLS

`src/ca_isrg_root_x1.h` holds the PEM as a `const char[]`, following the
existing `src/ota_pubkey.h` precedent for embedded key material. The upload
client calls `setCACert()`; `setInsecure()` never appears on this path.

Certificate verification requires a correct wall clock — mbedTLS checks
`notBefore`/`notAfter` against system time, which starts at the epoch on a cold
boot. This is the same precondition as the payload timestamp, so the single
"clock valid" gate before uploading covers both.

## Backend changes (`apps/web`, `infra/supabase-db`)

The BMP280 cannot report humidity, and the current contract requires it:

- Migration: `alter table public.readings alter column humidity drop not null`.
- `yarn regenerate:types` afterwards (required by CLAUDE.md) — the generated
  `infra/supabase-db/src/types/database.ts` currently types humidity as
  non-nullable in `Row`/`Insert`/`Update` and would otherwise reject a `null`
  write at compile time.
- `packages/shared/src/types/index.ts`: `SensorValues.humidity` becomes
  `number | null`, matching how `windSpeed`/`windDirection`/`precipitation` are
  already declared.
- `readingSchema` in `apps/web/src/lib/ingest/reading-schema.ts`: humidity gains
  `.nullable()`.
- The OpenAPI document needs no separate edit — `buildOpenApiDocument()`
  registers `readingSchema` directly, so it follows the schema change.
- Test updates: `apps/web/tests/unit/lib/ingest/reading-schema.test.ts` uses a
  missing `humidity` as its "rejects a missing required field" case, which stops
  being true; that test switches to a field that is still required, and a new
  case asserts `humidity: null` is accepted.

There is **no display layer to update**: `apps/web/src` currently has no
components, hooks, charts, or CSV export, and the Telegram bot function does not
read readings. The only consumer is the ingest write path. This is worth stating
because it is the one place a nullable column usually causes damage, and here it
cannot yet.

`rls-reviewer` runs after the migration, per CLAUDE.md.

## Error handling

| Condition | Behavior |
| --- | --- |
| Clock not yet valid | Skip the window, log once, keep sampling. `syncClock()` currently runs once per boot and is allowed to time out; since uploads now depend on it, a failed sync must be retried on later windows rather than leaving the device permanently mute |
| No samples in window | Skip, log — never fabricate a reading |
| Transport error / timeout / 5xx | Retry, up to 3 attempts total |
| 401 | Log "rejected — check DEVICE_SECRET / clock skew", drop immediately |
| 400 | Log the response body, drop immediately — the payload is malformed and resending cannot help |
| WiFi drops mid-upload | Drop the pending reading, reset the accumulator, fall through to the existing reconnect backoff |
| NVS holds a malformed URL | `http.begin()` fails and is treated as a transport error, so the reading exhausts its attempts and is dropped. There is no automatic fallback to the build-time URL — silently uploading somewhere other than where the operator pointed the device would be worse than failing visibly. The resolved URL is logged at boot and after every portal change, and the portal can correct it |

Sensor faults keep their existing MRP-11 behavior (implausible reading →
re-init), unchanged and independent of upload state.

## Testing

### Native unit (`pio test -e native`)

- `aggregate`: mean of a known sample set; empty window returns false; reset
  clears state; a long run of samples does not drift.
- `formatIso8601Utc`: a known epoch renders exactly, including zero-padding;
  buffer too small returns false.
- `buildReadingBody`: exact JSON shape, `null` for the absent sensors,
  round-trips through ArduinoJson.
- `signPayload`: matches a fixture generated by Node's
  `createHmac('sha256', secret).update(...)` — the same construction the route
  verifies. This is the highest-value test in the ticket: a signing mismatch is
  invisible on device except as a bare 401.
- `shouldRetryUpload`: true for negative codes and 5xx, false for 2xx and 4xx.

### Integration (`apps/web`)

The existing ingest tests cover the route. Added: a reading with
`humidity: null` is accepted and stored.

### Manual (on device — the ticket's own AC)

1. Boot connected; serial shows NTP sync and the resolved API URL.
2. Within ~5 minutes, serial shows a POST and a 201; the row appears in
   Supabase with a plausible mean temperature and pressure.
3. Power the router off mid-window: serial shows the retry schedule, then the
   drop, then the WiFi reconnect backoff — no reboot, no reset to setup mode.
4. Router back on: the loop resumes and the next window uploads normally.
5. Change the API URL from the web portal; after a reboot the new URL is used.
6. Flash a deliberately wrong `DEVICE_SECRET`: serial shows a 401 and an
   immediate drop with no retries.

Steps 2 and 6 need a reachable endpoint. Per the maintainer, verification runs
against the local dev server plus local Supabase for now; the production Vercel
run happens once that deployment exists, which is why the URL is runtime
configurable.

## Dependency & config changes

- No new `lib_deps` — `ArduinoJson`, `rweather/Crypto`, `HTTPClient`, and
  `WiFiClientSecure` are all already present and in use.
- `secrets.ini.example`: fix the `API_URL` path.
- Flash budget: the build currently sits at 82.8% of the 1280 KB app partition
  (1 085 525 bytes). The embedded root CA adds ~2 KB; the upload code is small
  and reuses the TLS stack the OTA path already links.

## Build sequence

1. `lib/aggregate/` + native tests.
2. `lib/upload/` + native tests, including the Node-generated signature fixture.
3. Backend: migration, regenerated types, zod schema, OpenAPI, dashboard
   null-handling.
4. `src/ca_isrg_root_x1.h`; upload state machine in `main.cpp`; NVS-backed URL
   plus the portal field; `secrets.ini.example` fix.
5. `firmware/README.md`: document the upload loop, retry/drop policy, and how
   to change the endpoint from the portal.
6. Verify: `pio test -e native && pio run`, then `yarn lint`,
   `yarn check-types`, `yarn test:unit`, `yarn build`, then the manual
   on-device checklist.

## Acceptance criteria mapping

- NTP sync after WiFi connect; timestamps on every payload → §Architecture,
  clock gate; `formatIso8601Utc`.
- Upload every `SEND_INTERVAL_MS`, configurable at flash time → window close in
  the upload sub-state machine; the existing build flag is unchanged.
- HMAC-SHA256 signature + `x-device-id` header → `signPayload`, verified
  against a Node fixture.
- HTTPS only, TLS verification enabled, no plaintext fallback → `setCACert()`
  with ISRG Root X1; no `setInsecure()` on this path.
- Failed POST retried 3× then dropped → 3-attempt policy, no buffering.
- WiFi loss returns to reconnect/backoff without reboot → existing
  `STATION_CONNECTING` path, pending upload discarded.
- Verified against the deployed endpoint → §Testing, Manual (local first, then
  production once deployed).
