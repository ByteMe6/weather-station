# MRP-46 — NVS device identity and manifest-driven upload interval

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one firmware image valid for the whole fleet by moving device identity into NVS, and let the upload interval be changed remotely through the signed OTA manifest.

**Architecture:** Identity moves from `-D` build flags into an NVS namespace read at boot, provisioned by flashing a generated `nvs.bin`. The OTA manifest gains an `intervalMs` field carried *inside* the Ed25519 signed message, and the device re-checks the manifest periodically rather than once per boot.

**Tech Stack:** PlatformIO + Arduino ESP32 core, `Preferences` (NVS), ArduinoJson 7, rweather/Crypto (Ed25519), Unity for host tests, Node `--experimental-strip-types` for the provisioning CLI, Python for the release script.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-10-mrp-46-firmware-nvs-identity-remote-interval-design.md`. Read it before starting.
- **Branch:** `mrp-46-firmware-nvs-identity-remote-interval`, branched from `dev`.
- **Rebase first.** PR #16 (MRP-43) is open against `dev` and modifies `attemptUpload()` — the same function Task 4 touches. Rebase onto `dev` once #16 merges, before starting Task 4.
- **NVS layout is the stock table:** `nvs` at `0x9000`, size `0x5000`; `app0` at `0x10000`, size `0x140000`. Do not change the partition table in this work.
- **Signed message grows from 36 to 40 bytes:** `version(4, LE) || sha256(32) || intervalMs(4, LE)`. This is breaking in both directions.
- **Interval clamp:** accept only `60000 … 3600000` ms inclusive. Reject outside, keep the previous value, log it.
- **Compiled default interval:** `300000`.
- **No `eslint-disable`, no `any`** in TypeScript (root `CLAUDE.md`). Arrow functions only.
- **Run `yarn format` before committing** — CI enforces `format:check`.
- Firmware C++ follows the surrounding style: comments explain *why*, not *what*.

---

### Task 1: Make the native test environment compile

`pio test -e native` currently fails to build `test_ota_state` and `test_upload`: ArduinoJson requires C++11 and `[env:native]` sets no standard. Every later task depends on host tests, so this comes first.

**Files:**
- Modify: `firmware/platformio.ini` (the `[env:native]` block)

**Interfaces:**
- Consumes: nothing
- Produces: a working `pio test -e native`, relied on by Tasks 2, 5, 6

- [ ] **Step 1: Confirm the failure and its cause**

Run: `cd firmware && pio test -e native -f test_ota_state 2>&1 | grep -m3 "error:"`

Expected output includes:
```
ArduinoJson.hpp:8:4: error: ArduinoJson requires C++11 or newer. Configure your compiler for C++11 or downgrade ArduinoJson to 6.20.
```

- [ ] **Step 2: Add the standard flag**

In `firmware/platformio.ini`, change the `[env:native]` `build_flags` line from:

```ini
build_flags = -I test/support
```

to:

```ini
; ArduinoJson 7 requires C++11; without an explicit standard the host compiler
; defaults to an older one and every test that includes it fails to build.
build_flags = -I test/support -std=gnu++11
```

- [ ] **Step 3: Run the full native suite**

Run: `cd firmware && pio test -e native`
Expected: all five suites PASS — `test_aggregate`, `test_ota_state`, `test_reading`, `test_upload`, `test_wifi_state`. No ERRORED rows.

- [ ] **Step 4: Confirm the board build is unaffected**

Run: `cd firmware && pio run -e esp32dev`
Expected: `SUCCESS`

- [ ] **Step 5: Commit**

```bash
git add firmware/platformio.ini
git commit -m "MRP-46: give the native test env a C++ standard

ArduinoJson 7 requires C++11. [env:native] set no -std, so the host
compiler defaulted lower and test_ota_state and test_upload failed to
build - which meant the manifest parser had no test coverage running at
all despite having tests written for it."
```

---

### Task 2: Carry `intervalMs` through the manifest parser

Parse and validate the new field, and expose the clamp as a pure function. Firmware-side only — the release script comes in Task 6.

**Files:**
- Modify: `firmware/lib/ota_state/ota_state.h`
- Test: `firmware/test/test_ota_state/test_ota_state.cpp`

**Interfaces:**
- Consumes: `pio test -e native` from Task 1
- Produces:
  - `OtaManifest::intervalMs` (`uint32_t`)
  - `bool isAcceptableInterval(uint32_t ms)` — true for `60000 … 3600000` inclusive
  - `void buildOtaSignedMessage(const OtaManifest &m, uint8_t out[40])`
  - `parseManifest()` now rejects a manifest with no `intervalMs`

- [ ] **Step 1: Update the fixtures that describe a valid manifest**

Making `intervalMs` required means every existing fixture that is *supposed to
parse* now describes an invalid manifest. Two of them do, and both must gain
the field or their tests break for the wrong reason.

In `firmware/test/test_ota_state/test_ota_state.cpp`, add `"intervalMs":300000,`
between the `sha256` and `sig` entries of:

- the `GOOD` constant near the top of the file
- the `tail` string inside `path_length_boundary()`

Change only the JSON, not the assertions. Leave every fixture that is meant to
*fail* parsing exactly as it is — adding the field to those could mask the
rejection path each one is checking.

- [ ] **Step 2: Write the failing tests**

Append to `firmware/test/test_ota_state/test_ota_state.cpp`, and add the new names to the `RUN_TEST` list at the bottom of the file:

```cpp
// intervalMs is required: the signed message covers it, so a manifest
// without one cannot be verified at all.
static const char NO_INTERVAL[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

static const char WITH_INTERVAL[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"intervalMs\":600000,"
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

static const char INTERVAL_NOT_A_NUMBER[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"intervalMs\":\"600000\","
    "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

void rejects_manifest_without_interval(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(NO_INTERVAL, m));
}

void rejects_non_numeric_interval(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(INTERVAL_NOT_A_NUMBER, m));
}

void parses_interval(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(WITH_INTERVAL, m));
  TEST_ASSERT_EQUAL_UINT32(600000, m.intervalMs);
}

void interval_bounds(void) {
  TEST_ASSERT_FALSE(isAcceptableInterval(59999));
  TEST_ASSERT_TRUE(isAcceptableInterval(60000));
  TEST_ASSERT_TRUE(isAcceptableInterval(300000));
  TEST_ASSERT_TRUE(isAcceptableInterval(3600000));
  TEST_ASSERT_FALSE(isAcceptableInterval(3600001));
  TEST_ASSERT_FALSE(isAcceptableInterval(0));
}

// Layout is load-bearing: the release script signs these exact bytes, so a
// disagreement here means every device rejects every image.
void signed_message_layout(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(WITH_INTERVAL, m));

  uint8_t msg[40];
  buildOtaSignedMessage(m, msg);

  // version = 2, little endian
  TEST_ASSERT_EQUAL_UINT8(0x02, msg[0]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[1]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[2]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[3]);
  // digest
  TEST_ASSERT_EQUAL_UINT8(0xaa, msg[4]);
  TEST_ASSERT_EQUAL_UINT8(0x11, msg[35]);
  // intervalMs = 600000 = 0x000927C0, little endian
  TEST_ASSERT_EQUAL_UINT8(0xC0, msg[36]);
  TEST_ASSERT_EQUAL_UINT8(0x27, msg[37]);
  TEST_ASSERT_EQUAL_UINT8(0x09, msg[38]);
  TEST_ASSERT_EQUAL_UINT8(0x00, msg[39]);
}
```

Register them in `main()` at the bottom of the same file, alongside the existing `RUN_TEST` calls:

```cpp
  RUN_TEST(rejects_manifest_without_interval);
  RUN_TEST(rejects_non_numeric_interval);
  RUN_TEST(parses_interval);
  RUN_TEST(interval_bounds);
  RUN_TEST(signed_message_layout);
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd firmware && pio test -e native -f test_ota_state`
Expected: FAIL — `'isAcceptableInterval' was not declared in this scope`, `'buildOtaSignedMessage' was not declared in this scope`, and `'struct OtaManifest' has no member named 'intervalMs'`.

- [ ] **Step 4: Implement**

In `firmware/lib/ota_state/ota_state.h`, add `intervalMs` to the struct and update its comment:

```cpp
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
```

In `parseManifest()`, add `intervalMs` to the type guard and read it:

```cpp
  if (!doc["version"].is<uint32_t>() || !doc["path"].is<const char *>() ||
      !doc["size"].is<uint32_t>() || !doc["sha256"].is<const char *>() ||
      !doc["intervalMs"].is<uint32_t>() || !doc["sig"].is<const char *>())
    return false;

  out.version = doc["version"].as<uint32_t>();
  out.intervalMs = doc["intervalMs"].as<uint32_t>();
  out.size = doc["size"].as<uint32_t>();
```

- [ ] **Step 5: Run to verify they pass**

Run: `cd firmware && pio test -e native -f test_ota_state`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 6: Commit**

```bash
git add firmware/lib/ota_state/ota_state.h firmware/test/test_ota_state/test_ota_state.cpp
git commit -m "MRP-46: carry intervalMs through the manifest parser

The field is required rather than optional-with-a-default: the signature
covers it, so a manifest without one cannot be verified anyway, and a
silent default is a failure mode nobody sees.

buildOtaSignedMessage() exists so the byte layout has one definition with
a test pinning it. The release script signs these same bytes; if the two
drift, every device rejects every image and the only symptom is a bad
signature."
```

---

### Task 3: Read device identity from NVS

Replace the compiled-in identity with NVS-backed values, and refuse to upload when it is missing.

**Files:**
- Modify: `firmware/src/main.cpp`
- Modify: `firmware/secrets.ini.example`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `String deviceId`, `String deviceSecret` — module-level, populated by `loadDeviceIdentity()`
  - `bool checkIdentity()` — false when either is empty, warns once

- [ ] **Step 1: Add the loader and the guard**

In `firmware/src/main.cpp`, next to the existing `cfgPrefs` / `apiUrl` declarations, add:

```cpp
// Identity is provisioned into NVS rather than compiled in, so one firmware
// image is valid for the whole fleet. With it in the binary, the single
// image OTA publishes would hand every device the same device_id and secret.
static Preferences idPrefs;
static String deviceId;
static String deviceSecret;
static bool identityWarned = false;

void loadDeviceIdentity() {
  idPrefs.begin("id", true);
  deviceId = idPrefs.getString("device_id", "");
  deviceSecret = idPrefs.getString("secret", "");
  idPrefs.end();
}

// Uploads are refused, but WiFi, the portal and the OTA check keep running -
// that is what lets a mis-provisioned device be recovered without physical
// access. Warned once: closeUploadWindow() calls this every window and the
// condition cannot change without a reflash.
static bool checkIdentity() {
  if (deviceId.length() > 0 && deviceSecret.length() > 0) return true;
  if (!identityWarned) {
    identityWarned = true;
    Serial.println("No device identity in NVS, uploads disabled - reflash nvs.bin");
  }
  return false;
}
```

- [ ] **Step 2: Call it at boot and use the values**

In `setup()`, add `loadDeviceIdentity();` immediately before the existing `loadApiUrl();`, then log it:

```cpp
  loadWifiCredentials();
  loadDeviceIdentity();
  loadApiUrl();
  Serial.printf("Device ID: %s\n", deviceId.length() ? deviceId.c_str() : "(none)");
  Serial.printf("Backend URL: %s\n", apiUrl.c_str());
```

In `closeUploadWindow()`, add the guard next to the existing scheme check — before the clock gate, since there is no point waiting on NTP for a reading that cannot be signed:

```cpp
  if (!checkApiUrlScheme()) return;
  if (!checkIdentity()) return;
  if (!ensureClock()) {
```

Replace the two macro uses. In `closeUploadWindow()`:

```cpp
  if (!signPayload(deviceSecret.c_str(), pendingTimestampMs, pendingBody,
                   pendingSignature, sizeof(pendingSignature))) {
```

In `attemptUpload()`:

```cpp
  http.addHeader("x-device-id", deviceId.c_str());
```

In `startSetupPortal()`, the AP name uses the identity too — fall back so a device with no identity still raises a portal with a usable name:

```cpp
  String apName = String("WeatherStation-") +
                  (deviceId.length() ? deviceId : String("unprovisioned"));
```

- [ ] **Step 3: Remove the build flags**

In `firmware/secrets.ini.example`, delete the `DEVICE_ID` and `DEVICE_SECRET` lines and rewrite the comment:

```ini
; Copy to secrets.ini (gitignored) and fill in before flashing. These are
; fleet-wide: every device gets the same values, so one firmware image serves
; all of them. Per-device identity is NOT here any more - it is provisioned
; into NVS, see "Provisioning identity" in README.md.
[secrets]
build_flags =
    -DAPI_URL=\"https://your-app.vercel.app/api/v1/readings\"
    -DOTA_BASE_URL=\"https://your-project.supabase.co/storage/v1/object/public/firmware\"
```

Move the interval default out of the per-device file into `firmware/platformio.ini`, in the `[env:esp32dev]` block:

```ini
; Fallback cadence, used until the manifest supplies one. Fleet-wide rather
; than per-device: with it in secrets.ini two devices would disagree on the
; fallback whenever the manifest is unreachable.
build_flags = ${secrets.build_flags} -DSEND_INTERVAL_MS=300000
```

- [ ] **Step 4: Update your own `secrets.ini` and build**

Your local `firmware/secrets.ini` still has the removed flags. Remove `DEVICE_ID`, `DEVICE_SECRET` and `SEND_INTERVAL_MS` from it so it matches the template.

Run: `cd firmware && pio run -e esp32dev`
Expected: `SUCCESS`. If it fails with `'DEVICE_SECRET' was not declared`, a macro use was missed — search with `grep -n "DEVICE_ID\|DEVICE_SECRET" src/main.cpp` and expect no hits.

- [ ] **Step 5: Commit**

```bash
git add firmware/src/main.cpp firmware/secrets.ini.example firmware/platformio.ini
git commit -m "MRP-46: read device identity from NVS instead of build flags

With identity compiled in, the single image ota_release.py publishes hands
every device the same device_id and secret - so OTA worked on exactly one
device. Reading it from NVS makes one image valid for the fleet.

No build-flag fallback on purpose: a fallback puts somebody's identity back
into the shared image, which is the whole problem.

A device with no identity refuses to upload but keeps WiFi, the portal and
the OTA check alive, so it can be recovered without physical access."
```

---

### Task 4: Apply the interval from the manifest

Store the cadence in NVS, prefer it over the compiled default, and apply it whenever a valid manifest is seen — regardless of whether the image is newer.

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `OtaManifest::intervalMs`, `isAcceptableInterval()`, `buildOtaSignedMessage()` from Task 2
- Produces: `uint32_t uploadIntervalMs` — the value `handleStationConnected()` compares the window against

- [ ] **Step 1: Add storage and the loader**

Next to `apiUrl` in `firmware/src/main.cpp`:

```cpp
// Upload cadence. NVS wins over the compiled default so the manifest can
// change it without a reflash; the compiled value is only the fallback for a
// device that has never seen a manifest.
static uint32_t uploadIntervalMs = (uint32_t)SEND_INTERVAL_MS;

void loadUploadInterval() {
  cfgPrefs.begin("cfg", true);
  uint32_t stored = cfgPrefs.getUInt("interval", 0);
  cfgPrefs.end();
  if (isAcceptableInterval(stored)) uploadIntervalMs = stored;
}

// Applied on every valid manifest, not only on a newer version:
// isNewerVersion() gates the image download, and gating config the same way
// would mean a cadence change needed a FW_VERSION bump and a full image
// republish - exactly what carrying it in the manifest is meant to avoid.
static void applyManifestInterval(uint32_t offered) {
  if (!isAcceptableInterval(offered)) {
    Serial.printf("OTA: interval %u out of range, keeping %u\n", offered, uploadIntervalMs);
    return;
  }
  if (offered == uploadIntervalMs) return;

  cfgPrefs.begin("cfg", false);
  cfgPrefs.putUInt("interval", offered);
  cfgPrefs.end();
  uploadIntervalMs = offered;
  Serial.printf("Upload interval set to %u ms\n", uploadIntervalMs);
}
```

- [ ] **Step 2: Call the loader and use the value**

In `setup()`, after `loadApiUrl();`:

```cpp
  loadUploadInterval();
```

In `handleStationConnected()`, replace both uses of the macro:

```cpp
    Serial.printf("Uploading to %s every %u ms\n", apiUrl.c_str(), uploadIntervalMs);
```

```cpp
  if (millis() - windowStart >= uploadIntervalMs) closeUploadWindow();
```

- [ ] **Step 3: Verify the signature over the new message and apply the interval**

In `checkForOtaUpdate()`, apply the interval as soon as the manifest parses, before the version comparison:

```cpp
  OtaManifest m;
  if (!parseManifest(body.c_str(), m)) {
    Serial.println("OTA: manifest rejected");
    return;
  }
  applyManifestInterval(m.intervalMs);
  if (!isNewerVersion(FW_VERSION, m.version)) {
```

In `installUpdate()`, replace the hand-rolled 36-byte message with the shared builder:

```cpp
  // Signature covers version + digest + interval so neither an old signed
  // image nor an altered cadence can be replayed under a newer version.
  uint8_t signedMsg[40];
  OtaManifest signedCopy = m;
  memcpy(signedCopy.sha256, digest, sizeof(digest));
  buildOtaSignedMessage(signedCopy, signedMsg);
  if (!Ed25519::verify(m.sig, OTA_PUBKEY, signedMsg, sizeof(signedMsg))) {
```

- [ ] **Step 4: Build**

Run: `cd firmware && pio run -e esp32dev`
Expected: `SUCCESS`

Run: `cd firmware && grep -n "SEND_INTERVAL_MS" src/main.cpp`
Expected: exactly one hit, the `uploadIntervalMs` initialiser.

- [ ] **Step 5: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "MRP-46: take the upload interval from the signed manifest

Stored in NVS and preferred over the compiled default, so a cadence change
survives a reboot and does not need a reflash.

Applied on every valid manifest rather than only a newer one: isNewerVersion
gates the image download, and gating config the same way would force a
FW_VERSION bump and a full image republish for a one-number change."
```

---

### Task 5: Re-check the manifest periodically

A device that never reboots never sees a new version today, because the only check is at boot. Config delivery makes that worse — a cadence change would wait for a power cut.

**Files:**
- Modify: `firmware/src/main.cpp`

**Interfaces:**
- Consumes: `checkForOtaUpdate()` as modified in Task 4
- Produces: nothing later tasks depend on

- [ ] **Step 1: Replace the boot-only flag**

In `firmware/src/main.cpp`, delete `static bool otaCheckedThisBoot = false;` and add:

```cpp
// Six hours. The boot-only check meant a device that stayed up never saw a
// new firmware version at all, and with the interval now arriving in the
// manifest it would never see a cadence change either.
static const uint32_t OTA_CHECK_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL;
static uint32_t lastOtaCheck = 0;
static bool otaCheckedThisBoot = false;
```

In `handleStationConnected()`, replace the existing block:

```cpp
  if (!otaCheckedThisBoot) {
    otaCheckedThisBoot = true;
    clockValid = syncClock();
    if (!clockValid) Serial.println("NTP sync timed out, will retry before the first upload");
    checkForOtaUpdate();
    lastOtaCheck = millis();
  } else if (millis() - lastOtaCheck >= OTA_CHECK_INTERVAL_MS) {
    // No syncClock() here: it blocks for up to 10s and the clock is already
    // good by now. Only the first check pays that cost.
    lastOtaCheck = millis();
    checkForOtaUpdate();
  }
```

- [ ] **Step 2: Build**

Run: `cd firmware && pio run -e esp32dev`
Expected: `SUCCESS`

- [ ] **Step 3: Commit**

```bash
git add firmware/src/main.cpp
git commit -m "MRP-46: re-check the OTA manifest every six hours

The check ran once per boot, so a device that stayed up never saw a new
firmware version - and with the upload interval now arriving in the
manifest, it would never see a cadence change either.

The periodic check deliberately skips syncClock(): that blocks for up to
10s and the clock is already valid by then. Only the first check pays it."
```

---

### Task 6: Sign and publish the interval

`ota_release.py` must sign the same 40 bytes the firmware verifies, and must allow republishing a manifest that changes only the interval.

**Files:**
- Modify: `firmware/scripts/ota_release.py`

**Interfaces:**
- Consumes: the byte layout defined by `buildOtaSignedMessage()` in Task 2
- Produces: manifests containing `intervalMs`

- [ ] **Step 1: Accept the argument**

At the top of `firmware/scripts/ota_release.py`, after the imports, add:

```python
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--interval-ms",
    type=int,
    default=300000,
    help="upload cadence pushed to the fleet, 60000-3600000 (default: 300000)",
)
args = parser.parse_args()

# Same bounds the firmware enforces in isAcceptableInterval(). Checked here
# too so a bad value fails at publish time rather than being silently
# refused by every device in the field.
if not 60000 <= args.interval_ms <= 3600000:
    die(f"--interval-ms must be between 60000 and 3600000, got {args.interval_ms}")
```

Note `die()` is defined below the imports in the current file — move the `argparse` block to after the `die()` definition so the call resolves.

- [ ] **Step 2: Sign the extended message**

Replace the signing block:

```python
digest = hashlib.sha256(image).digest()
# Signature covers version + digest + interval so neither a replayed old
# image nor an altered cadence can be passed off under a newer version.
# Layout must match buildOtaSignedMessage() in lib/ota_state/ota_state.h -
# if the two drift, every device rejects every image and the only symptom
# is "bad signature".
signed_message = (
    version.to_bytes(4, "little")
    + digest
    + args.interval_ms.to_bytes(4, "little")
)
```

- [ ] **Step 3: Publish the field, and allow interval-only republishes**

Add the field to the manifest dict:

```python
manifest = {
    "version": version,
    "path": name,
    "size": len(image),
    "sha256": digest.hex(),
    "intervalMs": args.interval_ms,
    "sig": base64.b64encode(sig).decode(),
}
```

Relax the version guard so a manifest that changes only the interval can be republished at the same version. Replace:

```python
    if published >= version:
        die(f"manifest already at v{published}; bump FW_VERSION in src/version.h")
```

with:

```python
    # A republish at the same version is legitimate when only the interval
    # changed - that is the point of carrying config in the manifest. Only a
    # *lower* version is a mistake. The image is re-uploaded either way; it is
    # byte-identical when the firmware has not changed.
    if published > version:
        die(f"manifest is at v{published}, refusing to publish older v{version}")
    if published == version:
        print(f"republishing v{version} (interval {args.interval_ms} ms)")
```

- [ ] **Step 4: Verify the script parses and rejects a bad interval**

Run: `cd firmware && python3 scripts/ota_release.py --interval-ms 5 2>&1 | tail -1`
Expected: `error: --interval-ms must be between 60000 and 3600000, got 5`

Run: `cd firmware && python3 scripts/ota_release.py --help 2>&1 | grep interval`
Expected: the `--interval-ms` help line.

Both exit before touching the network or requiring `OTA_SIGNING_KEY`, because
argument parsing and the bounds check run first. If instead you get
`OTA_SIGNING_KEY is not set`, the `argparse` block was placed after the `env()`
calls — move it up, keeping it below `die()`.

**Caveat on running these locally.** `ota_release.py` imports `requests` and
`cryptography` unconditionally at module top, so on a machine without those
installed both commands fail at the import line before argparse is ever
reached — which says nothing about whether your change is correct. Either run
them in a virtualenv that has both, or verify placement by reading the file:
the parser block must sit after `die()` and before the first `env()` call.
Do not move the imports to work around this; that is out of scope here.

- [ ] **Step 5: Commit**

```bash
git add firmware/scripts/ota_release.py
git commit -m "MRP-46: sign and publish the upload interval

The signed message now covers version + digest + interval, matching
buildOtaSignedMessage() in the firmware. Putting the interval inside the
signature rather than beside it is the point: without that, write access
to the storage bucket would be a fleet control channel.

Republishing at the same version is now allowed, since a manifest that
changes only the interval is a legitimate release. Only a lower version is
refused."
```

---

### Task 7: Emit a flashable NVS image from the provisioning CLI

**Files:**
- Modify: `infra/supabase-db/scripts/provision-device.ts`

**Interfaces:**
- Consumes: the `id` NVS namespace layout from Task 3 (`device_id`, `secret`)
- Produces: a `nvs.bin` and the esptool command to flash it

- [ ] **Step 1: Add the flag and CSV generation**

In `infra/supabase-db/scripts/provision-device.ts`, extend the imports and add after the existing `registerDevice` definition:

```typescript
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
```

```typescript
// nvs_partition_gen.py consumes this CSV shape: a namespace row, then one
// row per key. It ships with the Arduino ESP32 framework package rather than
// being a project dependency, so the path is resolved at call time and a
// clear error beats a stack trace when it is missing.
const buildNvsCsv = (id: string, secret: string) =>
  [
    'key,type,encoding,value',
    'id,namespace,,',
    `device_id,data,string,${id}`,
    `secret,data,string,${secret}`,
    '',
  ].join('\n')

// 0x5000 — the nvs partition size in the stock esp32dev table. Passing a
// different size produces an image that either wastes space or overruns the
// partition, and esptool will happily write the overrun.
const NVS_PARTITION_SIZE = '0x5000'

const emitNvsImage = (id: string, secret: string, outPath: string) => {
  const csvPath = `${outPath}.csv`
  writeFileSync(csvPath, buildNvsCsv(id, secret), { mode: 0o600 })

  const gen = process.env.NVS_PARTITION_GEN
  if (!gen) {
    throw new Error(
      'Set NVS_PARTITION_GEN to nvs_partition_gen.py, e.g.\n' +
        '  export NVS_PARTITION_GEN="$(find ~/.platformio/packages/framework-arduinoespressif32 -name nvs_partition_gen.py | head -1)"',
    )
  }

  execFileSync('python3', [gen, 'generate', csvPath, outPath, NVS_PARTITION_SIZE], {
    stdio: 'inherit',
  })
}
```

- [ ] **Step 2: Wire it to a flag**

Replace the final block of the script:

```typescript
const { deviceId, secret } = await registerDevice()

// Write to stderr, not stdout, so a plain `> file` redirect of stdout won't
// silently capture the secret to disk (an explicit `2>` still would).
console.error(
  '\nDevice added (unregistered). Put these in secrets.ini before flashing:',
)
console.error(`  DEVICE_ID     = ${deviceId}`)
console.error(`  DEVICE_SECRET = ${secret}\n`)
```

with:

```typescript
const { deviceId, secret } = await registerDevice()

const emitIndex = process.argv.indexOf('--emit-nvs')
const nvsPath = emitIndex === -1 ? null : process.argv[emitIndex + 1]

console.error('\nDevice added (unregistered).')
console.error(`  DEVICE_ID = ${deviceId}`)

if (!nvsPath) {
  // The secret only goes to stderr, never stdout, so a plain `> file`
  // redirect can't silently capture it (an explicit `2>` still would).
  console.error(`  DEVICE_SECRET = ${secret}`)
  console.error('\nPass --emit-nvs <path> to write a flashable NVS image instead.\n')
} else {
  emitNvsImage(deviceId, secret, nvsPath)
  console.error(`\nWrote ${nvsPath}. Flash it to a CLEAN device with:`)
  console.error(
    `  esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 ${nvsPath}\n`,
  )
  console.error(
    'This erases the whole NVS partition, including saved WiFi credentials.\n' +
      `Delete ${nvsPath} and ${nvsPath}.csv once flashed - both hold the secret.\n`,
  )
}
```

- [ ] **Step 3: Verify both paths**

With local Supabase running:

Run:
```bash
cd infra/supabase-db
SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SECRET_KEY="<local secret key>" yarn provision:device
```
Expected: prints `DEVICE_ID` and `DEVICE_SECRET`, plus the hint about `--emit-nvs`.

Run:
```bash
export NVS_PARTITION_GEN="$(find ~/.platformio/packages/framework-arduinoespressif32 -name nvs_partition_gen.py | head -1)"
SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SECRET_KEY="<local secret key>" yarn provision:device --emit-nvs /tmp/nvs.bin
```
Expected: `nvs_partition_gen.py` output, then the esptool instructions. Confirm the image is the right size:

Run: `ls -l /tmp/nvs.bin`
Expected: `20480` bytes (`0x5000`).

Clean up: `rm -f /tmp/nvs.bin /tmp/nvs.bin.csv`

- [ ] **Step 4: Check types and lint**

Run: `cd /Users/samedy/weather-station && yarn check-types && yarn lint`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add infra/supabase-db/scripts/provision-device.ts
git commit -m "MRP-46: emit a flashable NVS image from the provisioning CLI

--emit-nvs writes the device identity as an nvs.bin for esptool, so the
secret never has to be typed by hand or pasted into a per-device build
file. Without the flag the script behaves as before.

The image is written at the stock 0x5000 partition size; flashing it
erases the whole NVS partition, so it is a clean-device operation."
```

---

### Task 8: Document provisioning and the new destructive operations

**Files:**
- Modify: `firmware/README.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing

- [ ] **Step 1: Replace the identity paragraph**

In `firmware/README.md`, the WiFi setup section opens with:

```markdown
The device ships with no WiFi configured — only identity (`DEVICE_ID` /
`DEVICE_SECRET`) is flashed at manufacture time.
```

Replace with:

```markdown
The device ships with no WiFi configured — only its identity, which is
provisioned into NVS at manufacture time (see **Provisioning identity**).
```

- [ ] **Step 2: Add the provisioning section**

Insert before the `## Uploading readings` heading:

````markdown
## Provisioning identity

`DEVICE_ID` and `DEVICE_SECRET` are **not** build flags. They live in the
`id` NVS namespace, so a single firmware image is valid for every device —
which is what makes OTA usable on more than one of them.

```bash
export NVS_PARTITION_GEN="$(find ~/.platformio/packages/framework-arduinoespressif32 -name nvs_partition_gen.py | head -1)"
cd infra/supabase-db
yarn provision:device --emit-nvs /tmp/nvs.bin
esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 /tmp/nvs.bin
```

Delete `/tmp/nvs.bin` and `/tmp/nvs.bin.csv` afterwards — both contain the
secret.

**This is a clean-device operation.** Writing `nvs.bin` erases the whole NVS
partition, so an already-configured device also loses its saved WiFi
credentials and its stored backend URL, and returns to the setup portal.

Ordinary updates do not do this:

| Operation           | Writes                       | NVS        |
| ------------------- | ---------------------------- | ---------- |
| `pio run -t upload` | `app0` at `0x10000` only     | untouched  |
| OTA update          | the inactive `ota_0`/`ota_1` | untouched  |
| Flashing `nvs.bin`  | `0x9000`                     | **erased** |

Two things do destroy identity, and both now cost more than they used to:

- **`pio run -t erase`** wipes the whole chip, NVS included. The device must
  be re-provisioned over USB before it can upload again.
- **Changing the partition table.** `nvs` sits at `0x9000` sized `0x5000`;
  moving those boundaries destroys identity on every device that receives the
  new table. Plan such a migration separately — it cannot ride along in an
  ordinary release.

A device with no identity still boots, samples, joins WiFi and serves its
portal, and still checks for OTA updates — so it can be fixed remotely. It
just refuses to upload, and says so:

```
No device identity in NVS, uploads disabled - reflash nvs.bin
```
````

- [ ] **Step 3: Update the upload-cadence paragraph**

The `## Uploading readings` section currently says the window is
`SEND_INTERVAL_MS` "set at flash time". Replace that clause:

```markdown
Once WiFi is connected, the device averages the 2-second BMP280 samples over
each upload window and POSTs the mean temperature and pressure. The window
length comes from the OTA manifest's `intervalMs`, stored in NVS and
preferred over the compiled `SEND_INTERVAL_MS` default (`300000`, five
minutes) — so the cadence can be changed for the whole fleet by publishing a
manifest, with no reflash. Values outside 60 s–60 min are refused and logged.
```

- [ ] **Step 4: Fix the flash-time config list**

Near the top, the PlatformIO paragraph lists the build flags. Replace
`(`DEVICE_ID`, `DEVICE_SECRET`, `SEND_INTERVAL_MS`, `API_URL`, `OTA_BASE_URL`)`
with `(`API_URL`, `OTA_BASE_URL`, and the `SEND_INTERVAL_MS` fallback)`.

- [ ] **Step 5: Format and commit**

```bash
cd /Users/samedy/weather-station && yarn format
git add firmware/README.md
git commit -m "MRP-46: document NVS identity provisioning

Also spells out which operations erase NVS. Ordinary updates over USB or
OTA do not; flashing nvs.bin, a full-chip erase, and a partition-table
change do - and after this work the last two cost the device its identity,
not just its WiFi credentials."
```

---

### Task 9: Verify on hardware and open the PR

Nothing above proves the device actually works — the host tests cover the parser and the bounds, and everything else was only compiled.

**Files:** none

- [ ] **Step 1: Full native suite and both board builds**

Run: `cd firmware && pio test -e native`
Expected: five suites PASS.

Run: `cd firmware && pio run -e esp32dev && pio run -e esp32dev-local`
Expected: both `SUCCESS`.

- [ ] **Step 2: Confirm the refusal path first**

Do this before provisioning, so the device is already in the no-identity
state and nothing has to be undone. A full erase also clears WiFi, so the
device comes up in the setup portal:

```bash
cd firmware && pio run -e esp32dev -t erase && pio run -e esp32dev -t upload
```

Expected on serial, at boot:
```
Device ID: (none)
No saved WiFi - starting setup portal
```

Join `WeatherStation-unprovisioned` and configure WiFi through the captive
portal. `startSetupPortal()` falls back to that name precisely because there
is no identity to put in it.

Once it joins, expected on serial:
```
No device identity in NVS, uploads disabled - reflash nvs.bin
OTA: up to date (v1 published, v1 running)
```

The `OTA:` line is the point of this step: it proves a device with no
identity is still reachable by an update, which is the only way to recover
one that was mis-provisioned in the field. The refusal line appears when the
first upload window closes, so allow one interval for it.

- [ ] **Step 3: Provision the same device**

Regenerate the image — Task 7 had you delete it, and it holds the secret:

```bash
export NVS_PARTITION_GEN="$(find ~/.platformio/packages/framework-arduinoespressif32 -name nvs_partition_gen.py | head -1)"
cd infra/supabase-db
SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SECRET_KEY="<local secret key>" \
  yarn provision:device --emit-nvs /tmp/nvs.bin
esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 /tmp/nvs.bin
```

Expected on serial after the reset: `Device ID: ws-...` — not `(none)`.

Note this erased NVS again, so WiFi must be configured through the portal
once more. That is the clean-device constraint in practice, and worth seeing
first-hand before it is documented for someone else.

With the local stack running (Supabase, `yarn workspace @ws/web dev`, and a
tunnel), confirm a reading reaches Postgres:

```bash
docker exec supabase_db_weather-station psql -U postgres -d postgres \
  -c "select timestamp, temperature from readings order by timestamp desc limit 1;"
```

Then delete `/tmp/nvs.bin` and `/tmp/nvs.bin.csv`.

- [ ] **Step 4: Confirm a cadence change lands without a reflash**

Publish a manifest at the current version with a different interval:

```bash
cd firmware && infisical run -- python3 scripts/ota_release.py --interval-ms 600000
```

Expected on serial within one check period: `Upload interval set to 600000 ms`, with no reboot and no firmware download.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin mrp-46-firmware-nvs-identity-remote-interval
gh pr create --base dev --title "MRP-46: NVS device identity and manifest-driven upload interval"
```

The body must state the rollout order — flash every existing device over USB **before** publishing a new-format manifest — and that `ws-9f2b5a4bf93e` needs re-provisioning because its identity exists only inside the current binary.

---

## Notes for the implementer

**The signature change is breaking in both directions.** Old firmware cannot verify a new manifest; new firmware cannot verify an old one. Do not publish a new-format manifest until every device is on the new firmware. Reversing that order leaves devices unable to verify anything — including the update that would fix them.

**Task 4 conflicts with PR #16.** Both modify `attemptUpload()`. Rebase onto `dev` after #16 merges.

**Do not add a build-flag fallback for identity.** It is the first thing that looks helpful and it silently restores the bug this whole plan exists to remove: the shared OTA image would once again carry one device's credentials to every device.
