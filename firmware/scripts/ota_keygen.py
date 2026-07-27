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
