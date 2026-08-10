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

PlatformIO on top of Arduino adds: dependency management via `platformio.ini`, build flags for flash-time config injection (`API_URL`, `OTA_BASE_URL`, and the `SEND_INTERVAL_MS` fallback), VS Code integration, and CI-compatible builds without a GUI.

ESP-IDF would give finer RTOS and power control — neither is needed for MVP.

The platform and all libraries are **version-pinned** in `platformio.ini` so every machine and CI build the identical firmware. Bump pins deliberately, in their own PR.

## Structure

```
firmware/
  platformio.ini        # board, framework, pinned dependencies
  secrets.ini.example   # template for fleet-wide flash-time config
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

Altitude is derived from pressure against a local sea-level reference
(`SEA_LEVEL_HPA` at the top of `main.cpp`), not a separate measurement. Set it
to the current sea-level pressure from a nearby weather report; when the
altitude readout drifts with the weather, update the constant and re-flash.

> **Note:** the BMP280 has no humidity element. PRD F1 needs humidity, so the
> production sensor is a BME280 — swapping the driver back is a small change
> once that hardware is on hand.

## WiFi setup

The device ships with no WiFi configured — only its identity, which is
provisioned into NVS at manufacture time (see **Provisioning identity**).

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

## Provisioning identity

`DEVICE_ID` and `DEVICE_SECRET` are **not** build flags. They live in the
`id` NVS namespace, so a single firmware image is valid for every device —
which is what makes OTA usable on more than one of them.

```bash
pip install esp-idf-nvs-partition-gen
cd infra/supabase-db
yarn provision:device --emit-nvs /tmp/nvs.bin
esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 /tmp/nvs.bin
```

`NVS_PARTITION_GEN` can instead point at `nvs_partition_gen.py` from an
existing ESP-IDF checkout, for anyone who already has one — the Arduino
framework package PlatformIO installs does not ship that script, only
`gen_esp32part.py` (the partition _table_ generator), so there's nothing to
find under `~/.platformio`.

The script deletes `/tmp/nvs.bin.csv` itself, on both the success and
failure path — it's a transient input holding the plaintext secret. Delete
`/tmp/nvs.bin` by hand once it's flashed; that one has no self-cleanup.

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

## Uploading readings

Once WiFi is connected, the device averages the 2-second BMP280 samples over
each upload window and POSTs the mean temperature and pressure. The window
length comes from the OTA manifest's `intervalMs`, stored in NVS and
preferred over the compiled `SEND_INTERVAL_MS` default (`300000`, five
minutes) — so the cadence can be changed for the whole fleet by publishing a
manifest, with no reflash. Values outside 60 s–60 min are refused and logged.

A window that collected no valid samples is skipped rather than
reported as a zero reading; a window that closes while the previous reading is
still retrying supersedes it — the older one is dropped, not queued.

The payload is signed the way the ingest route verifies it: HMAC-SHA256 over
`<timestamp-ms>.<body>`, keyed with `DEVICE_SECRET` used as raw text (never
hex-decoded). The signature is sent as lowercase hex in `x-signature`,
alongside `x-device-id` and the same millisecond timestamp in `x-timestamp`.

Pretty-printed here for readability — on the wire it's a single unbroken
line, since the signature covers these exact bytes. The minified form is
pinned byte-for-byte in `builds_exact_payload` in
`test/test_upload/test_upload.cpp`.

```json
{
  "timestamp": "2026-08-04T12:00:00Z",
  "temperature": 21.53,
  "humidity": null,
  "pressure": 1013.24,
  "windSpeed": null,
  "windDirection": null,
  "precipitation": null
}
```

`humidity` is always null — the BMP280 has no humidity element (see the note
above). `windSpeed`, `windDirection` and `precipitation` are null because that
hardware doesn't exist yet. `pressure` is the measured station pressure, not
normalized to sea level.

**Delivery policy:** a reading gets at most 3 delivery attempts — the initial
POST plus two retries, spaced 10 s then 30 s — before it's dropped.

| Outcome                              | Behavior                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                                  | Success                                                                                                                                                   |
| Network error, timeout, or 5xx       | Retried, up to the attempt limit above                                                                                                                    |
| Any other 4xx (401, 400, …)          | Dropped immediately — the request would be rejected identically every time                                                                                |
| WiFi drops while a reading is queued | The reading (and any samples already collected for the current window) is dropped; the device falls back to the reconnect backoff above without rebooting |

There is no local buffering of undelivered readings — a deliberate MVP
decision (PRD OQ2), not an oversight.

**TLS:** uploads verify the server certificate against a small set of pinned
trust anchors in `src/ca_bundle.h` — ISRG Root X1 (Let's Encrypt), plus GTS
Root R1 and GTS Root R4 (Google Trust Services). By default there's no
plaintext fallback: a `Backend URL` that doesn't start with `https://` is
rejected and uploads stay disabled until it's fixed (see **Local
development** for the dev build that also accepts `http://`).

Two Google roots rather than one because the hosts this firmware talks to
chain to different ones — measured, not assumed:

| Host                | Chain                          |
| ------------------- | ------------------------------ |
| `vercel.app`        | RSA leaf → `WR1` → GTS Root R1 |
| `trycloudflare.com` | EC leaf → `WE1` → GTS Root R4  |

R1 covers the production backend; R4 covers the Cloudflare tunnel used for
local development (see **Local development**). Both are load-bearing — drop
R4 and a tunnel fails with the same `-9984`.

Note this is a property of each host, not of the handshake: `vercel.app` has
no EC certificate at all, so an ECDSA-only offer to it returns
`handshake_failure` rather than an R4 chain. Check what a host actually serves
before assuming an anchor covers it.

The consequence worth knowing: this is a **pin**, not the system trust store,
so the device will fail verification against any host whose certificate
chains to something else. That's by design rather than a bug — the payload
carries an HMAC over the device secret, and a permissive store would let any
CA-issued certificate terminate the connection. A backend that moves to a
fourth CA needs another anchor added here, and the only symptom until then is
mbedTLS `-9984` on every upload. This is unrelated to the OTA fetch, which
uses `setInsecure()` on purpose — see "OTA updates" below.

Verifying a certificate needs a correct clock: a window that closes before
NTP has synced is dropped rather than sent — nothing from it is retained, the
next window builds and sends a fresh average from newly collected samples. A
sync that times out is retried the next time a window closes, so the device
can't go permanently mute over one bad NTP lookup.

**Changing the endpoint:** the URL is read from NVS, falling back to the
flash-time `API_URL` build flag when NVS is empty. To repoint a device
without reflashing, open the same web portal described above (LAN IP printed
to serial), click **Setup** (not **Configure WiFi** — that page only holds
the SSID and password), and set **Backend URL**. Only `https://` values are
accepted (see **Local development** below for the dev build that also takes
`http://`), and the field holds at most 128 characters — a longer URL (for
example a flash-time `API_URL` over that length) is silently truncated when
the page pre-fills it, and saving the page without editing the field persists
that truncated value to NVS, breaking uploads until it's typed back in full
by hand. The active URL is logged to serial at boot and again whenever it's
changed from the portal.

The Setup page always reports "Saved" (HTTP 200) after a submit, whether or
not the URL was actually accepted — WiFiManager renders that confirmation
unconditionally and doesn't know about the `https://` check. A rejected URL
is left out of NVS and the device keeps using whatever endpoint was already
active. The one visible tell in the UI: the field snaps back to the active
URL, so if it shows something other than what you just typed, that submit was
rejected. The serial log (`Backend URL rejected: must start with https://`)
is the explicit confirmation.

## Local development

The upload path pins CA roots, so a self-signed certificate on a dev machine
will not validate — and plain `http://` is refused outright. That leaves
tunnelling a local server through a publicly trusted hostname, which is
awkward for day-to-day work.

The `esp32dev-local` build env exists for this. It is identical to `esp32dev`
apart from accepting `http://` backends:

```bash
pio run -e esp32dev-local -t upload
```

Then point **Backend URL** at your machine, e.g. `http://192.168.1.50:3000/api/v1/readings`.

A device flashed from this env prints a banner on every boot:

```
*** ALLOW_INSECURE_API_URL build - http:// backends accepted, DEV ONLY ***
```

If that line appears on a device that is meant to be in the field, it was
built from the wrong target — reflash it with `-e esp32dev`.

The flag deliberately lives in `platformio.ini` and not in `secrets.ini`.
`secrets.ini` is per-device and gets copied between them, so a relaxation
living there would eventually reach a device sending real readings. Selecting
a build target is an explicit act; copying a config file is not.

Note this only relaxes the **scheme check**. Over `https://` the CA pinning
still applies, so a tunnel with a publicly trusted certificate keeps working
exactly as before.

**Trust model:** the Setup page has no authentication, same as the WiFi
configuration page above — there is no `setAuth()` call anywhere in the
firmware. Before this branch that meant anyone on the LAN could change the
saved WiFi network; now it also means anyone on the LAN can repoint Backend
URL at a server they control. The only check is the `https://` prefix, and a
free Let's Encrypt certificate is available for any domain someone owns, so
that check says nothing about who's actually receiving the readings. A LAN
client that does this silently redirects all future uploads to their server
— the real dashboard just goes quiet, with nothing in the system flagging
the switch. This is an accepted MVP limitation, not a bug with a planned fix:
anyone with access to the device's LAN is trusted. Treat a device on an
untrusted or shared network as exposed.

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

Fleet-wide config — `API_URL` and `OTA_BASE_URL` — lives in `secrets.ini` (gitignored), **not** in the tracked `platformio.ini`: one firmware image is flashed to every device, so these are the same for all of them. Per-device identity is not here — it's provisioned separately into NVS, see **Provisioning identity** above.

```bash
cd firmware
cp secrets.ini.example secrets.ini
# edit secrets.ini: set API_URL, OTA_BASE_URL
```

Keep `API_URL` to 128 characters or fewer — see "Changing the endpoint" under Uploading readings for why.

## Local setup

1. Install PlatformIO: [VS Code extension](https://platformio.org/install/ide?install=vscode) or CLI via `pipx install platformio` (plain `pip install` fails on modern macOS/Ubuntu — [externally managed environments](https://packaging.python.org/en/latest/specifications/externally-managed-environments/))
2. `cd firmware && cp secrets.ini.example secrets.ini`
3. `pio run` — builds the firmware
4. `pio run --target upload` — flashes to connected ESP32
5. `pio device monitor` — opens serial monitor

## CI

Every PR builds the firmware (`pio run`) in the `firmware` job of `.github/workflows/ci.yml`, using `secrets.ini.example` as a stand-in config.
