# Step 3 — Scope / MVP

## In Scope

### Arduino Firmware
- Read BME280 sensor: temperature, humidity, atmospheric pressure
- Read anemometer via Hall sensor (A3144): wind speed
- Read wind vane via rotary encoder (KY-040): wind direction
- Read rain gauge via Hall sensor (A3144): precipitation
- Log all readings to SD card with RTC timestamps (DS1307)
- Transmit readings to backend over serial or WiFi

### Backend (Next.js API routes)
- Receive incoming sensor readings and persist them to a database
- Serve REST API endpoints for the web frontend and Telegram bot

### Web Dashboard (Next.js frontend)
- Real-time display of all sensor readings
- Historical charts for each parameter: last 24 h / 7 days / 30 days
- Data export: CSV

### Telegram Bot
- `/current` command — returns the latest readings on demand
- Scheduled alerts: multiple configurable time slots per day (e.g. 07:00, 12:00, 18:00)
- Exceptions: specific days or date ranges when scheduled alerts are skipped (weekends, holidays)

---

## Out of Scope

- LoRa / cellular fallback connectivity (WiFi only for now)
- Support for multiple simultaneous weather stations
- Mobile app (iOS / Android)
- Home-automation integrations (HomeKit, Google Home, MQTT)
- Weather forecasting
- Multi-user accounts and authentication
- GDPR / consent management flows
- Public API for third-party consumers
- Calibration tools or certified meteorological accuracy
- Additional Telegram commands beyond `/current`

---

## MVP

The smallest version that proves the core flow end-to-end:

1. **Arduino** reads the BME280 (temperature, humidity, pressure — no wind or rain yet) and transmits readings to the backend.
2. **Backend** receives and stores the readings.
3. **Web page** displays the current readings and a 24-hour chart.
4. **Telegram bot** responds to `/current` with the latest snapshot.

Wind / rain sensors, 7-day / 30-day charts, data export, and scheduled Telegram alerts are all confirmed in scope but deferred to the phase after MVP is working end-to-end.