# MRP-46 — Device identity in NVS, upload interval over OTA

**Status:** approved, not implemented
**Date:** 2026-08-10
**Ticket:** MRP-46

## Problem

`DEVICE_ID` and `DEVICE_SECRET` are build flags, so identity is compiled into
the binary. `scripts/ota_release.py` publishes one image and one global
`manifest.json` with no per-device targeting — every device fetches the same
bytes.

Those two facts together mean OTA works on exactly one device. With two, the
first update hands the second device the first one's identity: it signs with
the wrong secret and gets 401s, and both claim the same `device_id`
server-side. The versioning model breaks as well — with identity inside the
image there is no single "v2 binary", there are N binaries with N digests,
while the manifest carries one `version` and one `sha256`.

Separately, `SEND_INTERVAL_MS` is also a build flag, so changing the cadence
requires a rebuild and a reflash.

## Goals

1. One firmware image valid for the whole fleet.
2. Per-device identity provisioned without the secret travelling over the air
   or being typed by a human.
3. Upload interval changeable remotely, without a firmware version bump.
4. A device with no identity stays diagnosable and remotely fixable rather
   than bricked or silent.

## Non-goals

Per-device OTA targeting, staged rollouts, remote configuration of anything
beyond the interval, and rotating a device secret in the field.

---

## 1. Identity in NVS

New NVS namespace `id`:

| Key         | Type   | Notes                        |
| ----------- | ------ | ---------------------------- |
| `device_id` | string | e.g. `ws-9f2b5a4bf93e`       |
| `secret`    | string | 64-char hex, used as UTF-8   |

`loadDeviceIdentity()` mirrors the existing `loadApiUrl()`: read at boot into
module-level `String`s.

**`DEVICE_ID` and `DEVICE_SECRET` build flags are removed entirely.** No
fallback — a fallback reintroduces the exact problem this ticket exists to
fix, because the shared OTA image would once again carry somebody's identity.
`secrets.ini` keeps only `API_URL` and `OTA_BASE_URL`, which are fleet-wide.

`SEND_INTERVAL_MS` moves out of `secrets.ini` too, but to `platformio.ini`
rather than NVS: after this change it is a fleet-wide compiled *default* that
the manifest overrides, so it has no business in a per-device file. Leaving it
in `secrets.ini` would mean two devices disagreeing on the fallback cadence
whenever the manifest is unreachable.

`signPayload()` and the `x-device-id` header take the NVS values instead of
the macros. Neither is `const char *` from a macro any more, so both call
sites pass `.c_str()`.

### Provisioning

`yarn provision:device` gains `--emit-nvs <path>` which, in addition to
inserting the row, writes a `nvs.bin`:

1. Emit a CSV in `nvs_partition_gen.py` format holding the `id` namespace.
2. Invoke `nvs_partition_gen.py` (ships with the Arduino/ESP-IDF framework
   package) to produce `nvs.bin` sized `0x5000`.
3. Print the esptool command, or offer to run it.

Flashing writes it at the NVS partition offset. From the default partition
table for `esp32dev` (`framework-arduinoespressif32/tools/partitions/default.csv`):

```
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x140000,
app1,     app,  ota_1,   0x150000,0x140000,
```

`app0` at `0x140000` = 1310720 bytes, which matches the flash figure the build
reports — confirming the table in use.

**Writing `nvs.bin` erases the entire NVS partition**, including the `wifi`
namespace (saved credentials) and `cfg` (backend URL, and after this change
the interval).

To be precise about when that happens, because it is easy to read as worse
than it is:

| Operation             | Writes                       | NVS         |
| --------------------- | ---------------------------- | ----------- |
| `pio run -t upload`   | `app0` at `0x10000` only     | untouched   |
| OTA update            | the inactive `ota_0`/`ota_1` | untouched   |
| Flashing `nvs.bin`    | `0x9000`                     | **erased**  |

Erasure is not a side effect of updating — it only happens because
provisioning deliberately writes to the NVS offset. Ordinary firmware
updates, over USB or over the air, leave stored credentials and config alone.
This is already true today: reflashing during the MRP-16 run left the saved
WiFi credentials and the portal-set backend URL intact.

The consequence to document is narrower: re-provisioning an **already
configured** device — to change its identity, say — also drops its WiFi
credentials and sends it back to the setup portal. So identity provisioning
is a clean-device operation, and the README must say so next to the
provisioning steps.

### Two operations that now destroy identity

Both are deliberate acts rather than accidents, but both change meaning with
this design and need to be written down.

**`pio run -t erase`.** A full-chip erase takes NVS with it. Today that is
harmless: `DEVICE_ID` lives in the binary and survives, so an erase costs only
the WiFi credentials. After this change an erase leaves the device with no
identity at all and it must be re-provisioned over USB before it can upload
again. The README's troubleshooting section currently presents erase as a
routine reset — that has to be re-worded.

**Changing the partition table.** The layout is the stock one, `nvs` at
`0x9000` sized `0x5000`. Moving those boundaries destroys NVS contents on
every device that receives the new table, which after this change means
destroying fleet identity. This is not hypothetical: `app0` is already 84.4%
full, so a future feature could plausibly force a larger app partition. Such a
migration has to be planned as its own exercise — at minimum, reading identity
out before the change and writing it back after — and cannot ride along in an
ordinary release.

## 2. Missing identity

`checkIdentity()`, modelled on `checkApiUrlScheme()`: warn once, return false,
uploads disabled. Called from `closeUploadWindow()` alongside the existing
scheme check, before the clock gate — there is no point waiting on NTP for a
reading that cannot be signed.

Everything else keeps running: sensor sampling, WiFi, the web portal, and the
OTA check. That last one matters — it is what lets a mis-provisioned device be
recovered without physical access.

Log line names the cause and the fix, e.g.
`No device identity in NVS, uploads disabled - reflash nvs.bin`.

## 3. Interval in the signed manifest

`manifest.json` gains one field:

```json
{
  "version": 2,
  "path": "weatherstation-2.bin",
  "size": 1113504,
  "sha256": "…",
  "intervalMs": 300000,
  "sig": "…"
}
```

`intervalMs` is **required**. The signature format changes anyway, so there is
no compatibility argument for making it optional, and optional-with-a-default
is a silent-failure mode.

### Signature

The signed message extends from 36 to 40 bytes:

```
before:  version(4, LE) || sha256(32)
after:   version(4, LE) || sha256(32) || intervalMs(4, LE)
```

Without this, anyone able to write to the storage bucket could change the
cadence of the whole fleet. The bucket is public-read; write is service-role,
but the signature is what actually enforces authenticity here, and it should
cover everything the device acts on.

### Applying it

- Clamp to **60 000 … 3 600 000 ms**. Outside that range: ignore, keep the
  current value, log it. An unclamped value either hammers the backend or
  silently stops data collection, and both are one typo away in the release
  script.
- Persist the accepted value to NVS `cfg` under `interval`, so the device
  keeps the last known-good cadence when the manifest is unreachable.
- Precedence: NVS `interval` → compiled `SEND_INTERVAL_MS` default (300 000).
- **Apply the interval regardless of the version comparison.**
  `isNewerVersion()` gates the *image download* only. If config were gated the
  same way, changing the interval would require a `FW_VERSION` bump, which is
  precisely what this design avoids.

### Release script

`ota_release.py` takes `--interval-ms`, defaulting to 300 000, and includes it
in both the manifest and the signed message. Its existing refusal to publish
without a version bump stays for images; publishing a manifest that changes
only `intervalMs` at the same version must be allowed.

## 4. Periodic manifest check

`otaCheckedThisBoot` is replaced by a timestamp and a 6-hour interval. One
check serves both firmware and config.

This also fixes current behaviour: a device that never reboots never sees a
new firmware version at all, because the only check happens at boot.

The check keeps its existing position in `handleStationConnected()`, so it
still runs on a connected station with a valid clock.

---

## Testing

`lib/ota_state` already has native tests for the manifest parser. Added cases:

- `intervalMs` missing → manifest rejected
- `intervalMs` present but not a number → rejected
- Signature verified over the 40-byte message; a signature over the old
  36-byte message must fail
- Clamping: below range, above range, at both bounds, in range

Clamping and the signed-message layout are pure functions and run on the host
with no board.

On-device checks after implementation:

- Fresh device with `nvs.bin` uploads successfully
- Device with an empty `id` namespace logs the refusal, keeps portal and OTA
  alive, and does not upload
- Interval change published to the manifest takes effect within one check
  period without a reboot and without a version bump

## Rollout

The signature change is breaking in both directions — old firmware cannot
verify new manifests, new firmware cannot verify old ones. Order is fixed:

1. Flash the new firmware **and** `nvs.bin` over USB to every existing device.
   Today that is `ws-9f2b5a4bf93e` alone, whose identity exists only inside
   the current binary.
2. Only then publish a manifest in the new format.

Reversing this leaves devices unable to verify anything and therefore unable
to receive a correcting update over the air.

## Risks

| Risk                                            | Mitigation                                       |
| ----------------------------------------------- | ------------------------------------------------ |
| Re-provisioning a configured device wipes WiFi   | README warning; clean-device-only operation       |
| `pio run -t erase` now costs identity, not just WiFi | Re-word the README troubleshooting section    |
| A future partition-table change wipes fleet identity | Flagged as its own migration, never a release rider |
| Manifest published before devices updated        | Documented rollout order                          |
| Bad `intervalMs` in a release                    | Clamped range, logged rejection                   |
| Device provisioned with no identity              | Refusal path keeps OTA alive for recovery         |
| Secret readable from a recovered device          | Unchanged from today — it is in flash either way  |
