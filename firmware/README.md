# Firmware — ESP32

## Toolchain: Arduino core via PlatformIO

**Why PlatformIO + Arduino core (not bare ESP-IDF):**

Every library this project depends on lives in the Arduino ecosystem:

| Need                        | Library             | Arduino | ESP-IDF native |
| --------------------------- | ------------------- | ------- | -------------- |
| BMP280 sensor               | Adafruit BMP280     | ✅      | port yourself  |
| WiFi captive portal setup   | WiFiManager (tzapu) | ✅      | port yourself  |
| OTA firmware updates        | ArduinoOTA / Update | ✅      | port yourself  |
| HMAC-SHA256 payload signing | Crypto (rweather)   | ✅      | port yourself  |
| KY-040 rotary encoder       | ESP32Encoder        | ✅      | port yourself  |

PlatformIO on top of Arduino adds: dependency management via `platformio.ini`, build flags for flash-time config injection (`DEVICE_ID`, `DEVICE_SECRET`, `SEND_INTERVAL_MS`, `API_URL`, `OTA_BASE_URL`), VS Code integration, and CI-compatible builds without a GUI.

ESP-IDF would give finer RTOS and power control — neither is needed for MVP.

The platform and all libraries are **version-pinned** in `platformio.ini` so every machine and CI build the identical firmware. Bump pins deliberately, in their own PR.

## Structure

```
firmware/
  platformio.ini        # board, framework, pinned dependencies
  secrets.ini.example   # template for per-device flash-time config
  secrets.ini           # your local copy (gitignored — never commit)
  src/
    main.cpp            # entry point: WiFi provisioning state machine + BMP280 loop
```

## Sensors — BMP280 (I2C)

Default ESP32 I2C pins, so no build flags are needed for wiring:

| BMP280 | ESP32  |
| ------ | ------ |
| VCC    | 3V3    |
| GND    | GND    |
| SCL    | GPIO22 |
| SDA    | GPIO21 |

Address: firmware tries `0x76`, then `0x77` (`0x76` on most GY-BMP280 boards,
`0x77` on Adafruit's). `main.cpp` samples every 2 s and logs to serial at
115200 baud:

```
temp=23.41 C  pressure=1005.7 hPa  altitude=58.3 m
```

Altitude is derived from pressure against a fixed sea-level reference
(1013.25 hPa), not a separate measurement.

> **Note:** the BMP280 has no humidity element. PRD F1 needs humidity, so the
> production sensor is a BME280 — swapping the driver back is a small change
> once that hardware is on hand.

## WiFi setup

The device ships with no WiFi configured — only identity (`DEVICE_ID` /
`DEVICE_SECRET`) is flashed at manufacture time.

**First boot (no saved credentials):** the device starts an access point
named `WeatherStation-<DEVICE_ID>`. Connecting to it with a phone
auto-opens a captive portal that lists nearby networks and accepts a
password. Once submitted, credentials are saved to NVS (flash) and survive
power loss.

**Subsequent boots:** the device connects directly in station mode using
the saved credentials — no portal.

**After connecting:** the same portal stays available on the home network at
the device's IP (printed to serial as `Web portal: http://<ip>/`) — change
WiFi, view device info, or restart from a browser. Anyone on the LAN can
reach it; acceptable for MVP.

**Join failure:** the device retries the saved network forever, with
increasing backoff between attempts. It never falls back to reopening the
portal on its own:

| Attempt | Backoff before retry |
| ------- | -------------------- |
| 1       | 5 s                  |
| 2       | 10 s                 |
| 3       | 30 s                 |
| 4+      | 60 s                 |

**Reset button:**

| Function     | Pin                                     |
| ------------ | --------------------------------------- |
| Reset button | GPIO0 (onboard BOOT button, active-low) |

Holding it for 5 seconds wipes the saved WiFi credentials; the device then
restarts into setup mode (the access point above) as soon as the button is
released. The release step matters: GPIO0 is an ESP32 strap pin, so the
firmware deliberately waits for release before restarting.

## OTA updates

Once per boot, after WiFi connects, the device syncs its clock via NTP (up
to 10 s, non-fatal if it times out) and fetches `manifest.json` from the
public `firmware` Supabase Storage bucket. If the manifest offers a version
strictly greater than the running `FW_VERSION`, the image is downloaded to
the inactive app partition and installed only after two checks pass: the
SHA-256 digest matches the manifest, and the Ed25519 signature verifies
against the public key baked into the firmware. The signature covers the
version number + digest, so an old signed image can't be replayed as a
newer version.

Any failure — bad signature, interrupted download, unreachable bucket —
leaves the running firmware untouched. Worst case the device just doesn't
update until its next boot.

**Manifest format** (written by `scripts/ota_release.py`):

```json
{
  "version": 2,
  "path": "weatherstation-2.bin",
  "size": 1052672,
  "sha256": "<hex digest of the .bin>",
  "sig": "<base64 Ed25519 signature>"
}
```

**Release process:**

1. Bump `FW_VERSION` in `src/version.h`
2. `pio run`
3. Flash the bench device and confirm it boots. There is no crash-rollback
   — never publish an image that hasn't run on real hardware.
4. `infisical run -- python3 scripts/ota_release.py` — needs
   `OTA_SIGNING_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`; host deps are
   python3 with `cryptography` and `requests`
5. Devices pick it up on their next boot

**Key management:** the private key lives only in Infisical as
`OTA_SIGNING_KEY`. The public key in `src/ota_pubkey.h` is baked into every
shipped device — the pair can never be rotated in the field, so losing the
private key permanently ends OTA for every shipped unit.
`scripts/ota_keygen.py` is one-shot and refuses to run twice.

**Why the fetch uses `setInsecure()`:** pinning a CA into devices that may
never be reflashed bricks OTA the day the cert chain rotates. Authenticity
comes from the Ed25519 signature; TLS is just transport.

**Limitations:**

- No rollback if a verified image boots and then crashes — Arduino's
  prebuilt bootloader lacks `CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE`
- The check runs at boot only; a device that never reboots never updates

## Flash-time configuration

Per-device identity lives in `secrets.ini` (gitignored), **not** in the tracked `platformio.ini` — a real `DEVICE_SECRET` must never land in git history, since anyone with repo access could use it to forge signed readings for that device.

```bash
cd firmware
cp secrets.ini.example secrets.ini
# edit secrets.ini: set DEVICE_ID, DEVICE_SECRET, API_URL, OTA_BASE_URL
```

`DEVICE_ID` is also printed on the device label. `DEVICE_SECRET` never leaves the device.

## Local setup

1. Install PlatformIO: [VS Code extension](https://platformio.org/install/ide?install=vscode) or CLI via `pipx install platformio` (plain `pip install` fails on modern macOS/Ubuntu — [externally managed environments](https://packaging.python.org/en/latest/specifications/externally-managed-environments/))
2. `cd firmware && cp secrets.ini.example secrets.ini`
3. `pio run` — builds the firmware
4. `pio run --target upload` — flashes to connected ESP32
5. `pio device monitor` — opens serial monitor

## CI

Every PR builds the firmware (`pio run`) in the `firmware` job of `.github/workflows/ci.yml`, using `secrets.ini.example` as a stand-in config.
