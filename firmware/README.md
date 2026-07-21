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

PlatformIO on top of Arduino adds: dependency management via `platformio.ini`, build flags for flash-time config injection (`DEVICE_ID`, `DEVICE_SECRET`, `SEND_INTERVAL_MS`, `API_URL`), VS Code integration, and CI-compatible builds without a GUI.

ESP-IDF would give finer RTOS and power control — neither is needed for MVP.

The platform and all libraries are **version-pinned** in `platformio.ini` so every machine and CI build the identical firmware. Bump pins deliberately, in their own PR.

## Structure

```
firmware/
  platformio.ini        # board, framework, pinned dependencies
  secrets.ini.example   # template for per-device flash-time config
  secrets.ini           # your local copy (gitignored — never commit)
  src/
    main.cpp            # entry point: BMP280 sample + serial log loop
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

## Flash-time configuration

Per-device identity lives in `secrets.ini` (gitignored), **not** in the tracked `platformio.ini` — a real `DEVICE_SECRET` must never land in git history, since anyone with repo access could use it to forge signed readings for that device.

```bash
cd firmware
cp secrets.ini.example secrets.ini
# edit secrets.ini: set DEVICE_ID, DEVICE_SECRET, API_URL
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
