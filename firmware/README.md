# Firmware — ESP32

## Toolchain: Arduino core via PlatformIO

**Why PlatformIO + Arduino core (not bare ESP-IDF):**

Every library this project depends on lives in the Arduino ecosystem:

| Need | Library | Arduino | ESP-IDF native |
|------|---------|---------|----------------|
| BME280 sensor | Adafruit BME280 | ✅ | port yourself |
| WiFi captive portal setup | WiFiManager (tzapu) | ✅ | port yourself |
| OTA firmware updates | ArduinoOTA / Update | ✅ | port yourself |
| HMAC-SHA256 payload signing | Crypto (rweather) | ✅ | port yourself |
| KY-040 rotary encoder | ESP32Encoder | ✅ | port yourself |

PlatformIO on top of Arduino adds: dependency management via `platformio.ini`, build flags for flash-time config injection (`DEVICE_ID`, `DEVICE_SECRET`, `SEND_INTERVAL_MS`, `API_URL`), VS Code integration, and CI-compatible builds without a GUI.

ESP-IDF would give finer RTOS and power control — neither is needed for MVP.

## Structure

```
firmware/
  platformio.ini    # board, framework, dependencies, build flags
  src/
    main.cpp        # entry point (setup + loop)
```

## Flash-time configuration

In `platformio.ini`, set `build_flags` before flashing each device:

```ini
build_flags =
    -DDEVICE_ID=\"<uuid>\"
    -DDEVICE_SECRET=\"<secret>\"
    -DSEND_INTERVAL_MS=300000
    -DAPI_URL=\"https://your-app.vercel.app/api/readings\"
```

`DEVICE_ID` is also printed on the device label. `DEVICE_SECRET` never leaves the device.

## Local setup

1. Install [PlatformIO IDE](https://platformio.org/install/ide?install=vscode) (VS Code extension) or PlatformIO CLI: `pip install platformio`
2. `cd firmware && pio run` — builds the firmware
3. `pio run --target upload` — flashes to connected ESP32
4. `pio device monitor` — opens serial monitor
