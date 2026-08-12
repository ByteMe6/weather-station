#!/usr/bin/env python3
"""Sign the built image and publish it + manifest.json to Supabase Storage.

Usage (from firmware/, after `pio run`):
    infisical run -- python3 scripts/ota_release.py

Change only the fleet cadence, reusing the published image (no build needed):
    infisical run -- python3 scripts/ota_release.py --interval-only --interval-ms 600000

Env: OTA_SIGNING_KEY (base64 raw key), SUPABASE_URL, SUPABASE_SECRET_KEY.
"""
import argparse
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
# Only used when nothing has ever been published; an existing manifest's
# interval is carried forward instead. A default that always won would reset
# the fleet cadence on every release that forgot the flag.
DEFAULT_INTERVAL_MS = 300000


def die(msg):
    sys.exit(f"error: {msg}")


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--interval-ms",
    type=int,
    default=None,
    help="upload cadence pushed to the fleet, 60000-3600000 "
    "(default: whatever the published manifest carries, else 300000)",
)
parser.add_argument(
    "--interval-only",
    action="store_true",
    help="publish a cadence change over the already-published image: "
    "no build, no image upload, version unchanged",
)
args = parser.parse_args()


def env(name):
    value = os.environ.get(name)
    if not value:
        die(f"{name} is not set (run under `infisical run --`)")
    return value


base = env("SUPABASE_URL").rstrip("/") + "/storage/v1"
auth = {"Authorization": f"Bearer {env('SUPABASE_SECRET_KEY')}"}

# Loaded before anything is uploaded: a bad key discovered after the image is
# already in the bucket leaves an unreferenced binary behind.
try:
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(env("OTA_SIGNING_KEY")))
except Exception:
    die("OTA_SIGNING_KEY is not a valid base64 ed25519 key")

published = None
r = requests.get(f"{base}/object/public/{BUCKET}/manifest.json", timeout=15)
if r.ok:
    try:
        body = r.json()
    except ValueError:
        die("existing manifest is not valid json")
    if not isinstance(body, dict) or not isinstance(body.get("version"), int):
        die("existing manifest is not valid json")
    published = body
elif r.status_code not in (400, 404):
    # Anything other than not-found means we couldn't check the published
    # version - bail rather than risk re-publishing over a live release.
    # Supabase Storage returns 404 for a missing object on the public
    # endpoint; some deployments report it as 400, so both mean "no
    # manifest yet".
    die(f"manifest check failed: {r.status_code}")

# The cadence is sticky: a release that says nothing about it keeps whatever
# the fleet is already on. Otherwise an ordinary version bump would silently
# reset every device to the default.
if args.interval_ms is not None:
    interval_ms = args.interval_ms
    source = "--interval-ms"
elif published is not None and isinstance(published.get("intervalMs"), int):
    interval_ms = published["intervalMs"]
    source = "carried over from the published manifest"
else:
    interval_ms = DEFAULT_INTERVAL_MS
    source = "default, nothing published to carry over"

# Same bounds the firmware enforces in isAcceptableInterval(). Checked here
# too so a bad value fails at publish time rather than being silently
# refused by every device in the field.
if not 60000 <= interval_ms <= 3600000:
    die(f"interval must be between 60000 and 3600000, got {interval_ms}")
print(f"interval: {interval_ms} ms ({source})")

if args.interval_only:
    # Reuse the published image wholesale - the point of this path is that no
    # new binary exists, so nothing is built, uploaded or version-bumped. The
    # only field that changes is the cadence, and the signature is recomputed
    # over the published version + digest + the new interval.
    if published is None:
        die("--interval-only needs a published manifest to reuse, found none")
    if not isinstance(published.get("path"), str) or not published["path"]:
        die("published manifest has no usable path")
    if not isinstance(published.get("size"), int) or published["size"] <= 0:
        die("published manifest has no usable size")
    try:
        digest = bytes.fromhex(published.get("sha256", ""))
    except (TypeError, ValueError):
        digest = b""
    if len(digest) != 32:
        die("published manifest has no usable sha256")
    version = published["version"]
    name = published["path"]
    size = published["size"]
    print(f"interval-only: reusing published v{version} image {name} ({size} bytes)")
else:
    match = re.search(
        r"#define\s+FW_VERSION\s+(\d+)", (ROOT / "src" / "version.h").read_text()
    )
    if not match:
        die("FW_VERSION not found in src/version.h")
    version = int(match.group(1))

    bin_path = ROOT / ".pio" / "build" / "esp32dev" / "firmware.bin"
    if not bin_path.exists():
        die(f"{bin_path} missing - run `pio run` first")
    image = bin_path.read_bytes()
    digest = hashlib.sha256(image).digest()
    size = len(image)
    name = f"weatherstation-{version}.bin"

    if published is not None:
        if published["version"] > version:
            die(
                f"manifest is at v{published['version']}, refusing to publish older v{version}"
            )
        # Overwriting weatherstation-N.bin in place would replace a
        # bench-tested image with one no device has ever run (arduino-esp32
        # stamps __DATE__/__TIME__ into esp_app_desc, so rebuilds are never
        # byte-identical), and no device would install it anyway - the
        # firmware's version check is strictly-greater, so the release would
        # be invisible rather than merely redundant.
        if published["version"] == version:
            die(
                f"manifest is already at v{version} - bump FW_VERSION in src/version.h, "
                "or use --interval-only to change just the cadence"
            )

    r = requests.post(
        f"{base}/object/{BUCKET}/{name}",
        data=image,
        headers={**auth, "Content-Type": "application/octet-stream", "x-upsert": "true"},
        timeout=120,
    )
    if not r.ok:
        die(f"image upload failed: {r.status_code} {r.text}")

# Signature covers version + digest + interval so neither a replayed old
# image nor an altered cadence can be passed off under a newer version.
# Layout must match buildOtaSignedMessage() in lib/ota_state/ota_state.h -
# if the two drift, every device rejects every image and the only symptom
# is "bad signature".
signed_message = (
    version.to_bytes(4, "little") + digest + interval_ms.to_bytes(4, "little")
)
sig = key.sign(signed_message)

manifest = {
    "version": version,
    "path": name,
    "size": size,
    "sha256": digest.hex(),
    "intervalMs": interval_ms,
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

print(f"published v{version}: {name} ({size} bytes, interval {interval_ms} ms)")

# The rollout order is the one thing a publish can get catastrophically wrong,
# and it is invisible from here - only the operator knows whether the fleet has
# been reflashed. Printed at publish time because that is the moment it is
# actionable; README "Release process" carries the long form.
print(
    "\nreminder: the signed message is 40 bytes (version + digest + interval),\n"
    "which old firmware cannot verify. Order is fixed: USB-flash every existing\n"
    "device FIRST, publish a new-format manifest SECOND. Reversed, devices\n"
    "cannot verify the update that would fix them.\n"
    "Inert only while FW_VERSION is 1 - old firmware ignores a same-version\n"
    "republish - so a quiet release here proves nothing about the next bump."
)
