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
# Signature covers version + digest so an old image can't be replayed
# under a newer version number.
signed_message = version.to_bytes(4, "little") + digest
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
    if published >= version:
        die(f"manifest already at v{published}; bump FW_VERSION in src/version.h")
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
