# MRP-16 — End-to-end pipeline verification runbook

Phase 1 exit criteria: prove the device → backend → database chain works with
real hardware, including the negative security cases.

**Date:** 2026-08-10
**Firmware:** `FW_VERSION` 1, ESP32 dev board with **BMP280** (temperature and
pressure only — no humidity element)
**Device:** `ws-9f2b5a4bf93e`, provisioned via `yarn provision:device`
**Backend:** local Next.js dev server, exposed over a Cloudflare quick tunnel
**Database:** local Supabase (`127.0.0.1:54321`)

> **This run was against a local backend, not production.** AC3 (401s observed
> in Vercel logs) and AC4 (Vercel cold start) are production-only by definition
> and remain open. The ingest logic exercised here is identical — same route,
> same signature verification, same schema — but the ACs as written are not
> satisfied until they are re-run against the deployed app.

---

## Results

| AC  | Criterion                                        | Result      |
| --- | ------------------------------------------------ | ----------- |
| AC1 | Fresh setup via captive portal, no dev interaction | **PASS**\*  |
| AC2 | Readings every ~5 min for several hours, no gaps  | **NOT RUN** |
| AC3 | Forged signature and replay rejected with 401     | **PASS**\*\*|
| AC4 | Survives a Vercel cold start                      | **NOT RUN** |
| AC5 | Power-cycle resumes without reconfiguration       | **PASS**    |
| AC6 | This runbook                                      | **DONE**    |

\* with a caveat on "a network it has never seen" — see AC1 below.
\*\* with a material caveat on what "replay" means — see AC3 below.

---

## AC1 — First-time provisioning

**Method.** Held BOOT for 5 s to wipe stored credentials, then configured the
device from scratch through its captive portal, with no developer involvement
between the portal submit and the first upload.

**Evidence.**

| Step                          | Log line                                                        |
| ----------------------------- | --------------------------------------------------------------- |
| Reset button wipes creds      | `Reset button held 5s, wiping WiFi credentials`                  |
| NVS genuinely empty afterwards| `nvs_get_str len fail: ssid NOT_FOUND` (and `pass`)              |
| Portal opens unattended       | `No saved WiFi - starting setup portal`                          |
| AP raised                     | `StartAP with SSID: WeatherStation-ws-9f2b5a4bf93e` @ `192.168.4.1` |
| Rejoined the LAN              | device answers on `192.168.11.189`                               |
| Upload resumed unattended     | `POST /api/v1/readings 201`, row at `15:02:34`                   |

**Caveat — the AC is not fully satisfied.** The criterion says *"a network it
has never seen"*. Only one network was available, so after the wipe the device
was pointed at the same SSID. NVS was genuinely empty, so the provisioning path
ran end to end exactly as it would for an unknown network — but the literal
condition was not met and should be re-run where a second network exists.

**Bonus result.** `clearWifiCredentials()` clears only the `wifi` NVS namespace;
the backend URL lives in `cfg`. The URL survived the wipe, confirmed by the
device continuing to upload to a tunnel hostname that exists **only** in NVS and
not in the flashed build.

---

## AC3 — Signature forgery and replay

**Method.** Twelve cases driven directly at the ingest route with correctly and
incorrectly computed HMACs. Signature is HMAC-SHA256 over `${timestamp}.${rawBody}`
with the device secret used as UTF-8 text (`verify-signature.ts`).

| # | Case                                     | Expected | Got |
| - | ---------------------------------------- | -------- | --- |
| 1 | Valid signature (control)                | 201      | 201 |
| 2 | Forged signature (random 64-hex)         | 401      | 401 |
| 3 | Body swapped, signature from another body| 401      | 401 |
| 4 | Signed with the wrong secret             | 401      | 401 |
| 5 | Replay **outside** the window (301 s old)| 401      | 401 |
| 6 | Timestamp from the future (+301 s)       | 401      | 401 |
| 7 | Missing `x-signature`                    | 401      | 401 |
| 8 | Missing `x-device-id`                    | 401      | 401 |
| 9 | Missing `x-timestamp`                    | 401      | 401 |
| 10| Malformed signature (not 64-hex)         | 401      | 401 |
| 11| Uppercase hex signature                  | 401      | 401 |
| 12| Unknown device id                        | 401      | 401 |

### Material caveat: replay inside the window is NOT rejected

There is no nonce store. `route.ts` checks freshness only: a byte-identical
request repeated inside `REPLAY_WINDOW_MS` (300 000 ms) **passes authentication
and returns 201 a second time**. It does not duplicate data — `insertReading()`
upserts on `(device_id, timestamp)` with `ignoreDuplicates`, verified: 4 rows,
4 distinct pairs after a deliberate double-send.

So the AC wording — *"replayed request is rejected with 401"* — holds only for
replays **outside** the window. Inside the window the behaviour is idempotency,
not rejection. This is the documented design (`route.ts:39`), not a defect, but
it must not be recorded as "AC3 fully met" without this qualification.

---

## AC5 — Power cycle

**Method.** USB unplugged, ~5 s pause so capacitors drain (a warm reset would
not prove the same thing), replugged. No interaction afterwards.

| Criterion                    | Evidence                                                    |
| ---------------------------- | ----------------------------------------------------------- |
| Genuine cold start           | `rst:0x1 (POWERON_RESET)`                                    |
| Setup portal did **not** open| zero matches for `starting setup portal`                     |
| WiFi restored from NVS       | `Connecting to LOFT hotel (attempt 1)` → `WiFi got IP`       |
| Backend URL survived         | booted with the NVS tunnel URL, not the flashed one          |
| Upload resumed unattended    | `Reading uploaded (201)`, row at `14:56:30`                  |

---

## AC2 and AC4 — not run, and why

**AC2 (several hours, no gaps).** Blocked by the transport, not the firmware.
Account-less Cloudflare quick tunnels carry no uptime guarantee; one died after
roughly an hour with `Unauthorized: Tunnel not found`, and a hostname change
means the device must be repointed. A multi-hour run needs either a named
tunnel or the real Vercel deployment. `SEND_INTERVAL_MS` was also lowered to
60 000 for this session and must go back to 300 000 first.

**AC4 (Vercel cold start).** Production-only by definition.

---

## Defects found

### 1. TLS trust anchor pinned to the wrong CA — fixed in this session

Every upload failed with mbedTLS `-9984` (`X509 - Certificate verification
failed`) while the network, clock, sensor and payload were all healthy.

**Cause.** `attemptUpload()` pinned ISRG Root X1 alone, on the assumption
recorded in the old header that "Vercel issues under Let's Encrypt". Vercel now
serves `*.vercel.app` through **Google Trust Services** (`GTS Root R1` via the
`WR1` intermediate), so the pinned anchor no longer matched anything.

**Fix.** `src/ca_bundle.h` now carries three anchors — ISRG Root X1, GTS Root R1
and GTS Root R4 — each extracted from the macOS system trust store and verified
against a live chain. R4 is included deliberately: Google serves the RSA chain
(R1) or the ECC chain (R4) depending on what the client offers in the handshake,
so pinning only R1 leaves the fleet one cipher-preference change from the same
silent outage.

**Why the fleet was recoverable.** The OTA path calls `setInsecure()` and
authenticates images by Ed25519 signature instead of TLS, so a fix of exactly
this kind can still be delivered to devices that can no longer upload.

**Residual risk.** This remains a pin, not the system trust store. A backend
move to a fourth CA needs another entry. Worth a scheduled check that the anchor
set still matches what the host serves.

### 2. Local database silently out of date — environment, not code

Ingest returned HTTP 500 with an opaque `internal_error`. The insert was failing
with Postgres `23502`: `humidity` was still `not null` locally, and the BMP280
sends `null`.

The fix already existed in the repo (`2233d03`, migration
`20260804093001_humidity_nullable`) and had simply never been applied locally,
because the Supabase **storage** container was not running, which blocked
`20260727102352_firmware_ota_bucket`, which blocked every migration after it in
order. Restarting the stack with storage up applied all three.

**Lesson for the next person:** check `supabase migration list` before reading
the schema and drawing conclusions — an out-of-date local DB looks exactly like
a code bug.

### 3. Ingest route discards the underlying error

`route.ts` catches with bare `catch {}` in two places and returns a generic 500,
logging nothing. The opaque 401 for auth failures is a deliberate
anti-enumeration measure and should stay, but the **500** path hides real server
faults: diagnosing the `23502` above required reproducing the insert by hand
against Postgres. Server-side logging here would have made it immediate.

### 4. Chunked error bodies are logged with framing intact

Device log showed `Upload attempt 1 returned 500: 1a` followed by the JSON and a
`0`. `readBoundedErrorBody()` reads the raw stream without de-chunking, so the
chunk-length markers (`1a`, `0`) land in the log around the body. Cosmetic — the
body is only ever used for a log line — but it makes error output confusing.

### 5. WiFi disconnect reason codes incompletely mapped — fixed in this session

The new `wifiDisconnectReason()` helper printed `reason=8 (unmapped)` for an
ordinary deassociation on reboot. Codes 1, 3 and 8 — the normal ways a link ends
— were missing, making routine shutdowns read as anomalies. Added.

---

## Environment notes

- **Serial monitoring.** `pio device monitor` needs a TTY and cannot run
  detached. Reading the port directly requires setting the baud rate in the same
  process that opens it (`stty` beforehand is reset on open), and DTR/RTS must be
  set **before** opening or the board resets on every attach.
- **USB stability.** The connection began flapping after repeated BOOT presses —
  the button sits next to the socket. Device operation was unaffected (it stayed
  reachable and uploading), but the serial log became unusable. Secure the cable
  before attempting the AC2 long run.
- **Local backend for a pinning device.** The firmware refuses non-HTTPS URLs
  and pins CA roots, so a plain-HTTP or self-signed local server could not be
  used. A tunnel with a publicly trusted certificate was the path of least
  resistance; force `--protocol http2`, since QUIC failed repeatedly on this
  network (`datagram manager encountered a failure`).

  > **Superseded.** MRP-43 removed this constraint for development: the
  > `esp32dev-local` build env defines `ALLOW_INSECURE_API_URL` and accepts
  > `http://`, so a dev server on the LAN can be targeted directly with no
  > tunnel. The scheme check was also renamed `checkApiUrlHttps()` →
  > `checkApiUrlScheme()`. The tunnel is still needed on a network with client
  > isolation, which is what this session was run on. The rest of this entry
  > records what was true during the run.
- **Repointing without reflashing.** `loadApiUrl()` prefers the NVS value over
  the flashed `API_URL`, so a new tunnel hostname can be set through the device
  web portal (`POST /paramsave`, field `apiurl`). Confirmed working and
  persistent across both a power cycle and a credential wipe.

---

## Follow-up

Before this ticket can close, AC2 and AC4 need a run against the deployed app,
and AC1 needs a second network to satisfy its literal wording.

Defects 1 and 5 were fixed during this session (MRP-43, not yet committed).
Defect 3 is tracked as MRP-44. Defect 4 is cosmetic and is recorded here only —
it did not warrant a ticket. Defect 2 was an environment problem, not a code
change, and needs nothing beyond the lesson noted above.
