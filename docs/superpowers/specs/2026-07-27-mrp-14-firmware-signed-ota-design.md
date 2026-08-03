# MRP-14 — Firmware: signed OTA update check on boot

- **Ticket**: [MRP-14](https://linear.app/mrplit/issue/MRP-14) (High, Firmware, Phase 1)
- **Branch**: `mrp-14-firmware-signed-ota-update-check-on-boot` (based on the MRP-13 branch)
- **Date**: 2026-07-27
- **References**: `docs/04-prd.md` (F8), `docs/05-architecture-and-tech-stack.md`
  (normal-operation boot steps 3–4)

## Summary

The device is physical and can never be re-flashed once shipped — OTA is the
only field-fix path, so the first shipped firmware must already carry it. On
every boot, after WiFi connects and the clock syncs via NTP, the device fetches
a version manifest over HTTPS; if a newer, correctly signed image is published
it downloads to the inactive app partition, verifies the signature, switches
the boot partition, and reboots. Anything short of a fully verified image
leaves the running firmware untouched.

## What this ticket does NOT touch

- No sensor-reading POST loop (next ticket) — but the NTP sync added here is a
  prerequisite it will reuse.
- No periodic/scheduled update checks — boot-time only, per the ticket.
- No ESP32 Secure Boot / eFuse provisioning, and no crash-rollback of a
  successfully booted new image (see Limitations).

## Design decisions (resolved)

| Decision | Choice |
| --- | --- |
| Image + manifest hosting | Public Supabase Storage bucket `firmware`, created by a migration |
| Signature scheme | Ed25519 over the SHA-256 digest of the `.bin`; verified in-app before the boot partition is switched |
| Crypto library (device) | `rweather/Crypto@0.4.0` — already pinned in `platformio.ini` |
| Public key | Committed as a byte array in `src/ota_pubkey.h` |
| Private key | Infisical secret `OTA_SIGNING_KEY`; never on disk, never in the repo |
| Release tooling | `firmware/scripts/ota_keygen.py` (once) + `ota_release.py` (sign + upload), run under `infisical run --` |
| Version scheme | Monotonic integer `FW_VERSION` in `src/version.h`; device updates only when manifest version is strictly greater |
| Check cadence | Exactly once per boot, on first entry into `STATION_CONNECTED` |
| TLS for the fetch | `WiFiClientSecure::setInsecure()` — deliberate; see below |
| Manifest parsing | `bblanchon/ArduinoJson` (new pinned dep; host-compatible, so parse logic gets native tests) |
| Testable logic | `lib/ota_state/` — manifest parse + version compare, native Unity tests per the `lib/reading` / `lib/wifi_state` pattern |

### Why setInsecure() is the right call here

A CA certificate pinned into a device we cannot re-flash is a time bomb: when
the bucket's cert chain rotates to a different root, OTA dies permanently and
with it the only field-fix path. Authenticity and integrity of the image come
from the Ed25519 signature — an attacker who owns the network path can serve a
stale or garbage image and it will be rejected; the worst they get is knowing
the device checked for updates. TLS is transport, not trust.

## Hosting layout

```
supabase storage bucket "firmware" (public read, service-role write)
├── manifest.json
└── weatherstation-<version>.bin
```

`manifest.json`:

```json
{
  "version": 2,
  "path": "weatherstation-2.bin",
  "size": 1052672,
  "sha256": "<hex of the image digest>",
  "sig": "<base64 Ed25519 signature of the digest>"
}
```

The bucket is created by a Supabase migration (insert into `storage.buckets`,
public). Uploads use the service key from the release script; devices read
anonymously via the public object URL.

## Boot flow

```
STATION_CONNECTED (first entry this boot)
  1. configTime() NTP sync — wait up to 10 s, non-fatal on timeout (logged)
  2. otaCheckedThisBoot? → skip
  3. GET <bucket>/manifest.json  (HTTPS, setInsecure)
       parse fails / version <= FW_VERSION → done, mark checked
  4. GET the .bin → stream into Update (inactive app partition),
     SHA-256 computed incrementally during the write
  5. digest matches manifest.sha256 AND Ed25519 verify(sig, digest, pubkey) OK
       → Update.end() switches boot partition → ESP.restart()
     anything else (bad sig, short read, dropped connection, Update error)
       → abort, log, keep running current firmware, mark checked
```

Every failure path is non-fatal: OTA problems log and fall through to the
normal sensor loop. The inactive partition is scratch space — a half-written
or rejected image there is simply overwritten by the next attempt (next boot).

The default `esp32dev` partition table already provides dual OTA app slots
(app0/app1) and the current build uses ~69 % of one slot, so no
`platformio.ini` partition changes are needed.

## Components

### `lib/ota_state/` (new, native-testable)

- `parseManifest(const char *json, OtaManifest &out)` — ArduinoJson-based;
  rejects missing/wrong-typed fields, oversized values, non-hex sha256,
  non-base64 sig.
- `isNewerVersion(uint32_t current, uint32_t offered)` — strictly greater.
- Native Unity tests in `test/test_ota_state/`: good manifest, each missing
  field, wrong types, version equal/older/newer, garbage input. Plus an
  Ed25519 known-answer test if `rweather/Crypto` builds in the native env
  (verified during implementation; if it does not, signature verification is
  covered by the on-device test instead).

### `src/version.h` (new)

`#define FW_VERSION 1` — bumped manually per release; the release script
reads it to name the image and stamp the manifest.

### `src/ota_pubkey.h` (new)

32-byte Ed25519 public key array, generated once by `ota_keygen.py`.
Committed — it is public by definition.

### `src/main.cpp` (modified)

- NTP sync + one-shot OTA check wired into the first `STATION_CONNECTED`
  entry, before the sensor loop starts.
- OTA client: `HTTPClient` + `WiFiClientSecure` (both ship with the core),
  `Update.h` for partition writes, `SHA256`/`Ed25519` from rweather/Crypto.
- Prints current `FW_VERSION` at boot so serial logs identify what's running.

### `firmware/scripts/` (new)

- `ota_keygen.py` — generates an Ed25519 keypair, prints the private key
  (base64, for Infisical) and the C array for `ota_pubkey.h`. Run once.
- `ota_release.py` — builds nothing itself; takes the existing
  `.pio/build/esp32dev/firmware.bin`, reads `FW_VERSION`, signs the SHA-256
  digest with `OTA_SIGNING_KEY` from the environment, uploads
  `weatherstation-<version>.bin` + `manifest.json` to the bucket using
  `SUPABASE_URL`/`SUPABASE_SECRET_KEY`. Refuses to publish if the manifest
  already has an equal or newer version. Python, deps: `cryptography`,
  `requests`.

### Migration (`infra/supabase-db`)

One migration creating the public `firmware` bucket. No table changes, so no
type regeneration impact beyond the standard `yarn regenerate:types` run.

### `firmware/README.md` (modified)

New "OTA updates" section: hosting layout, manifest format, release process
step-by-step (bump `FW_VERSION` → `pio run` → `infisical run -- python
scripts/ota_release.py`), key management (where the private key lives, what
to do if it must be rotated — it can't be for already-shipped devices; the
public key is fixed for life, so the private key must never be lost), the
setInsecure rationale, and the crash-rollback limitation.

## Error handling

- Manifest unreachable / malformed → log, skip until next boot.
- Download interrupted / size mismatch / `Update` error → abort cleanly,
  current firmware keeps running (dual-partition guarantee).
- Signature or digest mismatch → image rejected, partition never activated.
- NTP timeout → logged, OTA proceeds anyway (signature verification does not
  depend on wall-clock time); readings tickets can revisit.
- WiFi drop mid-download → HTTP read fails → same abort path; the MRP-13
  reconnect state machine takes over.

## Limitations (documented, accepted for MVP)

- **No crash-rollback**: if a new image verifies, boots, and then crashes in a
  loop, the device stays on it. True rollback needs
  `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`, which the prebuilt Arduino
  bootloader doesn't set. Mitigation: never publish an image that hasn't run
  on the bench device first (README release checklist step).
- **Boot-time check only**: a device that stays up for months won't update
  until something reboots it. Acceptable now; a periodic re-check is a
  one-line follow-up ticket.

## Testing

### Native unit (`pio test -e native`)

`test_ota_state` as described above; existing `test_reading` and
`test_wifi_state` keep passing.

### Manual / end-to-end (the ticket's AC)

1. Flash `FW_VERSION 1` over USB. Serial shows version, NTP sync, "no update".
2. Bump to 2, build, `ota_release.py` → power-cycle the device → serial shows
   download + verify + reboot, then "version 2" running. (AC: publish test
   image → device picks it up.)
3. Publish a version-3 manifest whose `sig` is tampered → device logs a
   signature rejection and keeps running version 2. (AC: invalid signature
   rejected.)
4. Cut power mid-download (or kill WiFi) → device continues on the old image
   and retries next boot. (AC: interrupted download doesn't brick.)

## Implementation amendments (2026-07-27)

Recorded during implementation review; these supersede the corresponding
text above.

- **Signature covers version + digest, not the bare digest.** Review found a
  downgrade hole: signing only the image digest lets a MITM pair an old,
  validly signed image with a higher manifest version. The Ed25519 signature
  now covers a 36-byte message — 4-byte little-endian version followed by the
  32-byte image SHA-256. Release script, firmware verify, and the native KAT
  all use this layout. If this key ever signs images for a second product, a
  product identifier must be added to the signed message first — fielded
  devices cannot be re-keyed.
- **Native env accommodations for the Ed25519 KAT.** rweather/Crypto declares
  arduino-only frameworks, so `[env:native]` sets `lib_compat_mode = off` and
  includes a `test/support/Arduino.h` stub (chrono-backed millis/micros) to
  compile `RNG.cpp` on the host. Confined to the native env.
- **Download path hardening.** Manifest responses are capped at 4 KB and must
  carry a definite Content-Length matching the manifest size; per-read length
  is capped to the remaining image bytes; an absolute 10-minute download
  deadline backs the 15 s no-progress timeout; the manifest's TLS connection
  is dropped before the image connection opens (two concurrent TLS contexts
  don't fit comfortably in the heap).
- **Release script guard rails.** The pre-publish version check dies on any
  manifest-fetch status other than ok/404/400 instead of silently treating
  errors as "no manifest yet"; malformed manifest JSON and a malformed
  `OTA_SIGNING_KEY` die with clear messages (the key value is never echoed).

## Build sequence

1. Migration: `firmware` bucket.
2. `lib/ota_state/` + native tests.
3. `scripts/ota_keygen.py` + `ota_release.py`; generate the real keypair,
   store the private key in Infisical, commit `ota_pubkey.h`.
4. `src/version.h`, OTA client + NTP in `main.cpp`.
5. README section.
6. `pio test -e native && pio run`; end-to-end per §Testing.
