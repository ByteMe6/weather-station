# MRP-14 Signed OTA Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every boot, after WiFi + NTP, the device checks a Supabase Storage manifest and installs a newer Ed25519-signed firmware image into the inactive OTA partition, rejecting anything unsigned or corrupt.

**Architecture:** Public `firmware` bucket holds `manifest.json` + `.bin` images. A release script signs the SHA-256 digest of the image with an Ed25519 key held in Infisical; the firmware embeds the public key, streams the download into `Update` while hashing, and only switches boot partitions after the signature verifies. Manifest parsing and decoders live in `lib/ota_state/` with native Unity tests.

**Tech Stack:** ESP32 Arduino (`Update.h`, `HTTPClient`, `WiFiClientSecure`), rweather/Crypto (SHA256, Ed25519), ArduinoJson 7, Supabase Storage, Python (`cryptography`, `requests`) for release tooling.

**Spec:** `docs/superpowers/specs/2026-07-27-mrp-14-firmware-signed-ota-design.md`

Working directory for firmware tasks: `/home/samedy/weather-station/firmware`. `pio` is at `/home/samedy/.local/bin/pio`.

---

### Task 1: `firmware` storage bucket migration

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<timestamp>_firmware_ota_bucket.sql` (via `yarn migrate:new`)

- [ ] **Step 1: Create the migration file**

From `infra/supabase-db/`:

```bash
yarn migrate:new firmware_ota_bucket
```

Write into the generated file:

```sql
-- Public bucket for OTA firmware images and the version manifest. Devices
-- fetch anonymously via /storage/v1/object/public/firmware/...; uploads go
-- through scripts/ota_release.py with the service key (bypasses RLS).
insert into storage.buckets (id, name, public)
values ('firmware', 'firmware', true)
on conflict (id) do nothing;
```

No `storage.objects` policies: public-bucket reads are served by the public
object endpoint, and the only writer is the service role.

- [ ] **Step 2: Apply and regenerate types**

From `infra/supabase-db/`:

```bash
yarn migrate:up && yarn regenerate:types
```

Expected: migration applies; types diff is empty or trivial (storage schema is not part of the generated `public` types).

- [ ] **Step 3: Run the rls-reviewer agent on the migration** (project rule for any migration). Expected: no findings — the bucket is deliberately public, uploads are service-role only.

- [ ] **Step 4: Commit**

```bash
git add infra/supabase-db && git commit -m "MRP-14: public storage bucket for OTA images"
```

---

### Task 2: `lib/ota_state` — manifest parsing + decoders (native TDD)

**Files:**
- Modify: `firmware/platformio.ini` (add ArduinoJson to both envs, Crypto to native)
- Create: `firmware/lib/ota_state/ota_state.h`
- Create: `firmware/test/test_ota_state/test_ota_state.cpp`

- [ ] **Step 1: Add dependencies**

In `firmware/platformio.ini`, append to `[env:esp32dev]` `lib_deps`:

```ini
    bblanchon/ArduinoJson@7.4.2
```

and change `[env:native]` to:

```ini
[env:native]
platform = native
lib_deps =
    bblanchon/ArduinoJson@7.4.2
    rweather/Crypto@0.4.0
```

If `7.4.2` fails to resolve, pin the nearest available exact 7.x version and use it in both envs.

- [ ] **Step 2: Write the failing tests**

`firmware/test/test_ota_state/test_ota_state.cpp`:

```cpp
#include <unity.h>
#include <ota_state.h>
#include <string.h>

void setUp(void) {}
void tearDown(void) {}

// 32-byte sha256 = 64 hex chars; 64-byte sig = 88 base64 chars.
static const char GOOD[] =
    "{\"version\":2,\"path\":\"weatherstation-2.bin\",\"size\":1052672,"
    "\"sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa11\","
    "\"sig\":\"" // 64 bytes of 0x00 in base64
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}";

void parses_good_manifest(void) {
  OtaManifest m;
  TEST_ASSERT_TRUE(parseManifest(GOOD, m));
  TEST_ASSERT_EQUAL_UINT32(2, m.version);
  TEST_ASSERT_EQUAL_STRING("weatherstation-2.bin", m.path);
  TEST_ASSERT_EQUAL_UINT32(1052672, m.size);
  TEST_ASSERT_EQUAL_UINT8(0xaa, m.sha256[0]);
  TEST_ASSERT_EQUAL_UINT8(0x11, m.sha256[31]);
  TEST_ASSERT_EQUAL_UINT8(0x00, m.sig[0]);
  TEST_ASSERT_EQUAL_UINT8(0x00, m.sig[63]);
}

void rejects_garbage_json(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest("not json at all", m));
  TEST_ASSERT_FALSE(parseManifest("", m));
  TEST_ASSERT_FALSE(parseManifest("{}", m));
}

// Each required field missing -> reject.
void rejects_missing_fields(void) {
  OtaManifest m;
  TEST_ASSERT_FALSE(parseManifest(
      "{\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"size\":1,\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"sha256\":\"00\",\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sig\":\"AA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\"}", m));
}

void rejects_wrong_types_and_values(void) {
  OtaManifest m;
  // version as string
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":\"2\",\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // zero size
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":0,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  // empty path
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sha256(void) {
  OtaManifest m;
  // too short (2 chars), and right length but non-hex
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,\"sha256\":\"00\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "zz00000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void rejects_bad_sig(void) {
  OtaManifest m;
  // decodes to 3 bytes, not 64
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"AAAA\"}", m));
  // invalid base64 character
  TEST_ASSERT_FALSE(parseManifest(
      "{\"version\":2,\"path\":\"a.bin\",\"size\":1,"
      "\"sha256\":\"" "0000000000000000000000000000000000000000000000000000000000000000" "\","
      "\"sig\":\"!!AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==\"}", m));
}

void version_compare_is_strictly_greater(void) {
  TEST_ASSERT_TRUE(isNewerVersion(1, 2));
  TEST_ASSERT_FALSE(isNewerVersion(2, 2));
  TEST_ASSERT_FALSE(isNewerVersion(3, 2));
  TEST_ASSERT_TRUE(isNewerVersion(0, 1));
}

void hex_decoder_roundtrip(void) {
  uint8_t out[4];
  TEST_ASSERT_TRUE(decodeHex("deadBEEF", out, 4));
  TEST_ASSERT_EQUAL_UINT8(0xde, out[0]);
  TEST_ASSERT_EQUAL_UINT8(0xad, out[1]);
  TEST_ASSERT_EQUAL_UINT8(0xbe, out[2]);
  TEST_ASSERT_EQUAL_UINT8(0xef, out[3]);
  TEST_ASSERT_FALSE(decodeHex("dead", out, 4));   // too short
  TEST_ASSERT_FALSE(decodeHex("deadbeefaa", out, 4)); // too long
  TEST_ASSERT_FALSE(decodeHex("deadbeeg", out, 4));   // non-hex
}

void base64_decoder_strict(void) {
  uint8_t out[6];
  TEST_ASSERT_TRUE(decodeBase64("aGVsbG8h", out, 6)); // "hello!"
  TEST_ASSERT_EQUAL_UINT8('h', out[0]);
  TEST_ASSERT_EQUAL_UINT8('!', out[5]);
  uint8_t five[5];
  TEST_ASSERT_TRUE(decodeBase64("aGVsbG8=", five, 5)); // "hello"
  TEST_ASSERT_EQUAL_UINT8('o', five[4]);
  TEST_ASSERT_FALSE(decodeBase64("aGVsbG8=", out, 6));  // wrong out length
  TEST_ASSERT_FALSE(decodeBase64("aGVsbG8", five, 5));  // not multiple of 4
  TEST_ASSERT_FALSE(decodeBase64("aG=sbG8=", five, 5)); // pad mid-group
  TEST_ASSERT_FALSE(decodeBase64("", out, 6));
}

int main(int, char **) {
  UNITY_BEGIN();
  RUN_TEST(parses_good_manifest);
  RUN_TEST(rejects_garbage_json);
  RUN_TEST(rejects_missing_fields);
  RUN_TEST(rejects_wrong_types_and_values);
  RUN_TEST(rejects_bad_sha256);
  RUN_TEST(rejects_bad_sig);
  RUN_TEST(version_compare_is_strictly_greater);
  RUN_TEST(hex_decoder_roundtrip);
  RUN_TEST(base64_decoder_strict);
  return UNITY_END();
}
```

- [ ] **Step 3: Run tests, verify they fail**

```bash
pio test -e native -f test_ota_state
```

Expected: compile error (`ota_state.h` not found).

- [ ] **Step 4: Implement `firmware/lib/ota_state/ota_state.h`**

```cpp
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <ArduinoJson.h>

// Parsed manifest.json. sha256 is the digest of the .bin; sig is the
// Ed25519 signature of that digest.
struct OtaManifest {
  uint32_t version;
  char path[96];
  uint32_t size;
  uint8_t sha256[32];
  uint8_t sig[64];
};

// Update only when the offered version is strictly newer.
inline bool isNewerVersion(uint32_t current, uint32_t offered) {
  return offered > current;
}

inline int hexNibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// Strict: input must be exactly 2*outLen hex chars.
inline bool decodeHex(const char *s, uint8_t *out, size_t outLen) {
  if (strlen(s) != outLen * 2) return false;
  for (size_t i = 0; i < outLen; i++) {
    int hi = hexNibble(s[i * 2]);
    int lo = hexNibble(s[i * 2 + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return true;
}

inline int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

// Strict: standard base64 with padding, must decode to exactly outLen bytes.
inline bool decodeBase64(const char *s, uint8_t *out, size_t outLen) {
  size_t len = strlen(s);
  if (len == 0 || len % 4 != 0) return false;

  size_t pad = 0;
  if (s[len - 1] == '=') pad++;
  if (pad && s[len - 2] == '=') pad++;
  if (len / 4 * 3 - pad != outLen) return false;

  size_t o = 0;
  for (size_t i = 0; i < len; i += 4) {
    bool lastGroup = (i + 4 == len);
    int v[4];
    for (int j = 0; j < 4; j++) {
      char c = s[i + j];
      if (c == '=') {
        // '=' only in the last group, only positions 2/3, no data after it
        if (!lastGroup || j < 2) return false;
        if (j == 2 && s[i + 3] != '=') return false;
        v[j] = 0;
      } else {
        v[j] = base64Value(c);
        if (v[j] < 0) return false;
      }
    }
    uint32_t triple = ((uint32_t)v[0] << 18) | ((uint32_t)v[1] << 12) |
                      ((uint32_t)v[2] << 6) | (uint32_t)v[3];
    out[o++] = (uint8_t)(triple >> 16);
    if (!(lastGroup && pad >= 2)) out[o++] = (uint8_t)(triple >> 8);
    if (!(lastGroup && pad >= 1)) out[o++] = (uint8_t)triple;
  }
  return o == outLen;
}

inline bool parseManifest(const char *json, OtaManifest &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) return false;

  if (!doc["version"].is<uint32_t>() || !doc["path"].is<const char *>() ||
      !doc["size"].is<uint32_t>() || !doc["sha256"].is<const char *>() ||
      !doc["sig"].is<const char *>())
    return false;

  out.version = doc["version"].as<uint32_t>();
  out.size = doc["size"].as<uint32_t>();
  if (out.size == 0) return false;

  const char *path = doc["path"].as<const char *>();
  if (strlen(path) == 0 || strlen(path) >= sizeof(out.path)) return false;
  strncpy(out.path, path, sizeof(out.path));

  if (!decodeHex(doc["sha256"].as<const char *>(), out.sha256, sizeof(out.sha256)))
    return false;
  if (!decodeBase64(doc["sig"].as<const char *>(), out.sig, sizeof(out.sig)))
    return false;
  return true;
}
```

Note: ArduinoJson 7 `JsonDocument` allocates on the heap and `.is<uint32_t>()`
returns false for JSON strings/floats — that's what the wrong-type tests pin.

- [ ] **Step 5: Run tests, verify they pass**

```bash
pio test -e native -f test_ota_state
```

Expected: 9/9 PASS. Then the full suite:

```bash
pio test -e native
```

Expected: test_reading + test_wifi_state + test_ota_state all pass.

- [ ] **Step 6: Commit**

```bash
git add platformio.ini lib/ota_state test/test_ota_state
git commit -m "MRP-14: ota manifest parsing with native tests"
```

---

### Task 3: Ed25519 known-answer test (native)

**Files:**
- Modify: `firmware/test/test_ota_state/test_ota_state.cpp`

- [ ] **Step 1: Generate a test vector**

Run (host python; `pip install --user cryptography` if missing):

```bash
python3 - <<'EOF'
import base64, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
key = Ed25519PrivateKey.from_private_bytes(bytes(range(32)))  # deterministic test key
pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
digest = hashlib.sha256(b"weatherstation ota kat").digest()
sig = key.sign(digest)
fmt = lambda b: ", ".join(f"0x{x:02x}" for x in b)
print("pub:", fmt(pub)); print("digest:", fmt(digest)); print("sig:", fmt(sig))
EOF
```

- [ ] **Step 2: Add the KAT to `test_ota_state.cpp`**

```cpp
#include <Ed25519.h>

// Vector generated with python cryptography from a fixed test key
// (see the plan doc); not the production key.
static const uint8_t KAT_PUB[32] = {/* paste pub bytes */};
static const uint8_t KAT_DIGEST[32] = {/* paste digest bytes */};
static const uint8_t KAT_SIG[64] = {/* paste sig bytes */};

void ed25519_verifies_known_answer(void) {
  TEST_ASSERT_TRUE(Ed25519::verify(KAT_SIG, KAT_PUB, KAT_DIGEST, sizeof(KAT_DIGEST)));
}

void ed25519_rejects_tampered_digest(void) {
  uint8_t bad[32];
  memcpy(bad, KAT_DIGEST, 32);
  bad[0] ^= 0x01;
  TEST_ASSERT_FALSE(Ed25519::verify(KAT_SIG, KAT_PUB, bad, sizeof(bad)));
}
```

Register both with `RUN_TEST` in `main`.

- [ ] **Step 3: Run and verify**

```bash
pio test -e native -f test_ota_state
```

Expected: 11/11 PASS. **Fallback:** if rweather/Crypto fails to compile in the
native env, remove it from `[env:native]` lib_deps, drop these two tests, and
note in the README that signature verification is covered by the on-device
tamper test (spec explicitly allows this).

- [ ] **Step 4: Commit**

```bash
git add platformio.ini test/test_ota_state
git commit -m "MRP-14: ed25519 known-answer test"
```

---

### Task 4: Release tooling + real keypair

**Files:**
- Create: `firmware/scripts/ota_keygen.py`
- Create: `firmware/scripts/ota_release.py`
- Create: `firmware/src/ota_pubkey.h` (generated)

- [ ] **Step 1: Write `firmware/scripts/ota_keygen.py`**

```python
#!/usr/bin/env python3
"""Generate the Ed25519 OTA signing keypair. Run once, ever.

Writes src/ota_pubkey.h and prints the private key for Infisical. The public
key is baked into every shipped device, so losing the private key means no
device can ever be updated again.
"""
import base64
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

out = Path(__file__).resolve().parent.parent / "src" / "ota_pubkey.h"
if out.exists():
    sys.exit(f"{out} already exists - refusing to overwrite a live keypair")

key = Ed25519PrivateKey.generate()
priv = key.private_bytes(
    serialization.Encoding.Raw,
    serialization.PrivateFormat.Raw,
    serialization.NoEncryption(),
)
pub = key.public_key().public_bytes(
    serialization.Encoding.Raw, serialization.PublicFormat.Raw
)

rows = [", ".join(f"0x{b:02x}" for b in pub[i : i + 8]) for i in range(0, 32, 8)]
out.write_text(
    "#pragma once\n"
    "#include <stdint.h>\n\n"
    "// Ed25519 public key for OTA image verification. The private half lives\n"
    "// in Infisical (OTA_SIGNING_KEY). Shipped devices can only ever verify\n"
    "// against this key - it cannot be rotated in the field.\n"
    "static const uint8_t OTA_PUBKEY[32] = {\n"
    "    " + ",\n    ".join(rows) + ",\n"
    "};\n"
)

print(f"wrote {out}")
print("store this in Infisical as OTA_SIGNING_KEY (never commit, never lose):")
print(base64.b64encode(priv).decode())
```

- [ ] **Step 2: Write `firmware/scripts/ota_release.py`**

```python
#!/usr/bin/env python3
"""Sign the built image and publish it + manifest.json to Supabase Storage.

Usage (from firmware/, after `pio run`):
    infisical run -- python3 scripts/ota_release.py

Env: OTA_SIGNING_KEY (base64 raw key), SUPABASE_URL, SUPABASE_SECRET_KEY.
"""
import base64
import hashlib
import json
import os
import re
import sys
from pathlib import Path

import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "firmware"


def die(msg):
    sys.exit(f"error: {msg}")


def env(name):
    value = os.environ.get(name)
    if not value:
        die(f"{name} is not set (run under `infisical run --`)")
    return value


match = re.search(r"#define\s+FW_VERSION\s+(\d+)", (ROOT / "src" / "version.h").read_text())
if not match:
    die("FW_VERSION not found in src/version.h")
version = int(match.group(1))

bin_path = ROOT / ".pio" / "build" / "esp32dev" / "firmware.bin"
if not bin_path.exists():
    die(f"{bin_path} missing - run `pio run` first")
image = bin_path.read_bytes()

digest = hashlib.sha256(image).digest()
key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(env("OTA_SIGNING_KEY")))
sig = key.sign(digest)

base = env("SUPABASE_URL").rstrip("/") + "/storage/v1"
auth = {"Authorization": f"Bearer {env('SUPABASE_SECRET_KEY')}"}

r = requests.get(f"{base}/object/public/{BUCKET}/manifest.json", timeout=15)
if r.ok:
    published = r.json().get("version", 0)
    if published >= version:
        die(f"manifest already at v{published}; bump FW_VERSION in src/version.h")

name = f"weatherstation-{version}.bin"
r = requests.post(
    f"{base}/object/{BUCKET}/{name}",
    data=image,
    headers={**auth, "Content-Type": "application/octet-stream", "x-upsert": "true"},
    timeout=120,
)
if not r.ok:
    die(f"image upload failed: {r.status_code} {r.text}")

manifest = {
    "version": version,
    "path": name,
    "size": len(image),
    "sha256": digest.hex(),
    "sig": base64.b64encode(sig).decode(),
}
r = requests.post(
    f"{base}/object/{BUCKET}/manifest.json",
    data=json.dumps(manifest, indent=2),
    headers={**auth, "Content-Type": "application/json", "x-upsert": "true"},
    timeout=30,
)
if not r.ok:
    die(f"manifest upload failed: {r.status_code} {r.text}")

print(f"published v{version}: {name} ({len(image)} bytes)")
```

- [ ] **Step 3: Generate the real keypair**

```bash
cd /home/samedy/weather-station/firmware && python3 scripts/ota_keygen.py
```

Expected: `src/ota_pubkey.h` written; private key printed once.

- [ ] **Step 4: Store the private key in Infisical** (user-visible step — the
implementer should surface the printed key to the user and ask them to run
`infisical secrets set OTA_SIGNING_KEY=<printed value>` or add it via the
Infisical UI, then confirm). Do NOT write the private key to any file in the
repo, the scratchpad, or the shell history beyond the keygen output.

- [ ] **Step 5: Commit** (public key + scripts only — verify with `git status`
that nothing else is staged)

```bash
git add scripts/ota_keygen.py scripts/ota_release.py src/ota_pubkey.h
git commit -m "MRP-14: release signing tooling + ota public key"
```

---

### Task 5: Firmware integration — version, NTP, OTA check

**Files:**
- Create: `firmware/src/version.h`
- Modify: `firmware/src/main.cpp`
- Modify: `firmware/secrets.ini.example`

- [ ] **Step 1: Create `firmware/src/version.h`**

```cpp
#pragma once

// Bump for every published release. The device updates only when the
// manifest version is strictly greater than this.
#define FW_VERSION 1
```

- [ ] **Step 2: Add the OTA base URL to `firmware/secrets.ini.example`**

Append to the `build_flags` list:

```ini
    -DOTA_BASE_URL=\"https://your-project.supabase.co/storage/v1/object/public/firmware\"
```

The user must add the real line to their gitignored `secrets.ini` themselves
(agent hooks block that file) — ask them to before the build step, pointing
at their project ref `dlzfxrrnloxtyjzavbob`.

- [ ] **Step 3: Wire OTA into `firmware/src/main.cpp`**

Add includes after the existing ones:

```cpp
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Update.h>
#include <SHA256.h>
#include <Ed25519.h>
#include <time.h>
#include <ota_state.h>
#include "version.h"
#include "ota_pubkey.h"
```

Add near the other state globals:

```cpp
static bool otaCheckedThisBoot = false;
```

Add these functions above `handleStationConnected()`:

```cpp
// Anything past 2023 means NTP answered; RTC starts at epoch.
static bool syncClock() {
  configTime(0, 0, "pool.ntp.org", "time.google.com");
  uint32_t start = millis();
  while (time(nullptr) < 1700000000 && millis() - start < 10000) {
    delay(250);
  }
  return time(nullptr) >= 1700000000;
}

static bool installUpdate(const OtaManifest &m) {
  WiFiClientSecure client;
  client.setInsecure();  // authenticity comes from the image signature, not TLS
  HTTPClient http;
  String url = String(OTA_BASE_URL) + "/" + m.path;
  if (!http.begin(client, url)) return false;
  if (http.GET() != HTTP_CODE_OK) {
    http.end();
    Serial.println("OTA: image fetch failed");
    return false;
  }
  if (http.getSize() > 0 && (uint32_t)http.getSize() != m.size) {
    http.end();
    Serial.println("OTA: size mismatch");
    return false;
  }

  if (!Update.begin(m.size)) {
    http.end();
    Serial.printf("OTA: cannot start update: %s\n", Update.errorString());
    return false;
  }

  SHA256 sha;
  uint8_t buf[1024];
  WiFiClient *stream = http.getStreamPtr();
  uint32_t written = 0;
  uint32_t lastData = millis();
  while (written < m.size && millis() - lastData < 15000) {
    size_t avail = stream->available();
    if (avail == 0) {
      if (!client.connected()) break;
      delay(10);
      continue;
    }
    size_t n = stream->readBytes(buf, avail < sizeof(buf) ? avail : sizeof(buf));
    if (n == 0) continue;
    sha.update(buf, n);
    if (Update.write(buf, n) != n) break;
    written += n;
    lastData = millis();
  }
  http.end();

  if (written != m.size) {
    Update.abort();
    Serial.printf("OTA: download incomplete (%u/%u bytes)\n", written, m.size);
    return false;
  }

  uint8_t digest[32];
  sha.finalize(digest, sizeof(digest));
  if (memcmp(digest, m.sha256, sizeof(digest)) != 0) {
    Update.abort();
    Serial.println("OTA: digest mismatch, image rejected");
    return false;
  }
  if (!Ed25519::verify(m.sig, OTA_PUBKEY, digest, sizeof(digest))) {
    Update.abort();
    Serial.println("OTA: bad signature, image rejected");
    return false;
  }

  // Only now does the boot partition switch.
  if (!Update.end()) {
    Serial.printf("OTA: finalize failed: %s\n", Update.errorString());
    return false;
  }
  Serial.printf("OTA: v%u installed, rebooting\n", m.version);
  ESP.restart();
  return true;  // unreachable
}

static void checkForOtaUpdate() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, OTA_BASE_URL "/manifest.json")) return;
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    http.end();
    Serial.printf("OTA: manifest fetch failed (%d)\n", code);
    return;
  }
  String body = http.getString();
  http.end();

  OtaManifest m;
  if (!parseManifest(body.c_str(), m)) {
    Serial.println("OTA: manifest rejected");
    return;
  }
  if (!isNewerVersion(FW_VERSION, m.version)) {
    Serial.printf("OTA: up to date (v%u published, v%u running)\n", m.version, (uint32_t)FW_VERSION);
    return;
  }
  Serial.printf("OTA: v%u available, downloading %s\n", m.version, m.path);
  installUpdate(m);
}
```

In `handleStationConnected()`, insert right after the drop-check block (before
`if (!webPortalRunning) ...`):

```cpp
  // One check per boot, right after the first successful connect. Blocks the
  // loop for the NTP wait + download - fine at boot, nothing else is running.
  if (!otaCheckedThisBoot) {
    otaCheckedThisBoot = true;
    if (!syncClock()) Serial.println("NTP sync timed out, continuing");
    checkForOtaUpdate();
  }
```

In `setup()`, right after `Serial.begin(115200);` add:

```cpp
  Serial.printf("Weather Station fw v%u\n", (uint32_t)FW_VERSION);
```

- [ ] **Step 4: Build**

```bash
pio run
```

Expected: SUCCESS. Flash usage grows (crypto + HTTP stack); anything under
~85 % of the 1.31 MB app slot is fine. Also re-run `pio test -e native` —
still all green.

- [ ] **Step 5: Commit**

```bash
git add src/version.h src/main.cpp secrets.ini.example
git commit -m "MRP-14: boot-time signed ota check + ntp sync"
```

---### Task 6: README — OTA + release process docs

**Files:**
- Modify: `firmware/README.md`

- [ ] **Step 1: Add an "OTA updates" section** after the WiFi setup section, covering exactly:

- On every boot after WiFi connects, the device syncs NTP then fetches
  `manifest.json` from the public `firmware` bucket; a strictly newer version
  is downloaded to the inactive partition and installed only after its SHA-256
  digest and Ed25519 signature check out. One check per boot.
- Manifest format (the JSON block from the spec).
- Release process, step by step:
  1. Bump `FW_VERSION` in `src/version.h`.
  2. `pio run`
  3. Flash the bench device and confirm it boots (no crash-rollback exists —
     never publish an image that hasn't run on real hardware).
  4. `infisical run -- python3 scripts/ota_release.py` (needs `OTA_SIGNING_KEY`,
     `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; python deps: `cryptography`, `requests`).
  5. Devices pick it up on their next boot.
- Key management: private key only in Infisical as `OTA_SIGNING_KEY`; the
  public key in `src/ota_pubkey.h` is baked into shipped devices, so the key
  pair can never be rotated in the field — losing the private key permanently
  ends OTA for every shipped unit.
- Why the fetch uses `setInsecure()` (pinned CA = bricked OTA on cert
  rotation; trust lives in the signature).
- Limitations: no crash-rollback of a verified-and-booted image; check runs
  at boot only.
- Add `-DOTA_BASE_URL` to the secrets.ini documentation table/example text.

Match the README's existing voice — short sentences, tables where they fit.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "MRP-14: document ota release process + key handling"
```

---

### Task 7: Full verification + end-to-end test

- [ ] **Step 1: Full local suite**

```bash
pio test -e native && pio run
```

Expected: all tests pass, build SUCCESS.

- [ ] **Step 2: End-to-end with the user** (needs the physical device + their
secrets.ini updated with `OTA_BASE_URL`):

1. Flash v1 over USB: `pio run -t upload && pio device monitor`. Serial shows
   `fw v1`, NTP sync, and `OTA: manifest fetch failed (400/404)` (empty
   bucket) or `up to date`.
2. Bump `FW_VERSION` to 2, `pio run`, publish:
   `infisical run -- python3 scripts/ota_release.py`. Power-cycle the device →
   serial shows download, `OTA: v2 installed, rebooting`, then `fw v2`. Revert
   `version.h` to the committed state afterwards if 2 isn't being kept.
3. Tamper test: download `manifest.json`, flip one character inside `sig`,
   re-upload (curl with the service key or Supabase Studio), power-cycle →
   serial shows `OTA: bad signature, image rejected` and the device keeps
   running. Restore the good manifest afterwards.
4. Interrupt test: power-cycle mid-download → device boots the old image and
   retries next boot.

- [ ] **Step 3: Update the spec's amendments section** if implementation
diverged anywhere, then run `git status` to confirm nothing unintended is
left uncommitted.
