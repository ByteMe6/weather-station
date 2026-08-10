#!/usr/bin/env python3
"""Sign the built image and publish it + manifest.json to Supabase Storage.

Usage (from firmware/, after `pio run`):
    infisical run -- python3 scripts/ota_release.py

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


def die(msg):
    sys.exit(f"error: {msg}")


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
try:
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(env("OTA_SIGNING_KEY")))
except Exception:
    die("OTA_SIGNING_KEY is not a valid base64 ed25519 key")
sig = key.sign(signed_message)

base = env("SUPABASE_URL").rstrip("/") + "/storage/v1"
auth = {"Authorization": f"Bearer {env('SUPABASE_SECRET_KEY')}"}

r = requests.get(f"{base}/object/public/{BUCKET}/manifest.json", timeout=15)
if r.ok:
    try:
        manifest_json = r.json()
        published = manifest_json["version"] if isinstance(manifest_json, dict) else None
    except ValueError:
        published = None
    if not isinstance(published, int):
        die("existing manifest is not valid json")
    # A republish at the same version is legitimate when only the interval
    # changed - that is the point of carrying config in the manifest. Only a
    # *lower* version is a mistake. The image is re-uploaded either way; it is
    # byte-identical when the firmware has not changed.
    if published > version:
        die(f"manifest is at v{published}, refusing to publish older v{version}")
    if published == version:
        print(f"republishing v{version} (interval {args.interval_ms} ms)")
elif r.status_code not in (400, 404):
    # Anything other than not-found means we couldn't check the published
    # version - bail rather than risk re-publishing over a live release.
    # Supabase Storage returns 404 for a missing object on the public
    # endpoint; some deployments report it as 400, so both mean "no
    # manifest yet".
    die(f"manifest check failed: {r.status_code}")

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
    "intervalMs": args.interval_ms,
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
