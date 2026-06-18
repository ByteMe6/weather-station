# Step 3 — Scope / MVP

## In Scope

### ESP32 Firmware
- Read BME280 sensor: temperature, humidity, atmospheric pressure
- Read anemometer via Hall sensor (A3144): wind speed
- Read wind vane via rotary encoder (KY-040): wind direction
- Read rain gauge via Hall sensor (A3144): precipitation (rain only)
- Obtain timestamps via NTP (no hardware RTC needed)
- Transmit readings to backend over HTTPS

### Web App (Next.js — frontend + backend)
- API routes receive incoming sensor readings over HTTPS and persist to Supabase
- API routes serve data to the frontend and Telegram bot
- Real-time display of all sensor readings
- Historical charts for each parameter: last 24 h / 7 days / 30 days
- Data export: CSV with selectable date range

### Telegram Bot (TypeScript)
- `/current` command — returns the latest readings on demand
- Scheduled alerts: user-configurable time slots and days of the week (multiple per day allowed)

### Infrastructure
- Monorepo with two apps: `web` (Next.js — frontend + backend), `bot` (TypeScript)
- Database: Supabase (managed PostgreSQL — no self-hosted DB container)
- Shared `packages/db` (Prisma + Supabase)

---

## Out of Scope

- LoRa / cellular fallback connectivity (WiFi only)
- Support for multiple simultaneous weather stations
- Mobile app (iOS / Android)
- Home-automation integrations (HomeKit, Google Home, MQTT)
- Weather forecasting
- Multi-user accounts and authentication
- GDPR / consent management flows (not triggered by MVP — no personal data collected)
- Public API for third-party consumers
- Calibration tools or certified meteorological accuracy
- Snow measurement (rain only; post-MVP)

---

## MVP

The smallest version that proves the core flow end-to-end:

1. **ESP32** reads the BME280 (temperature, humidity, pressure — no wind or rain yet) and POSTs readings to the backend over HTTPS.
2. **Next.js API route** receives and stores the readings in Supabase.
3. **Next.js frontend** displays current readings and a 24-hour chart.
4. **Telegram bot** responds to `/current` with the latest snapshot and sends a scheduled daily alert at one configurable time.

Wind / rain sensors, 7-day / 30-day charts, CSV export, and full multi-slot scheduling are confirmed in scope but deferred to the phase after the MVP is working end-to-end.

### Acceptance Criteria
- A new reading appears on the dashboard within 15 s of the ESP32 sending it
- `/current` responds within 2 s
- Scheduled alert fires within 1 min of the configured time
- Data in PostgreSQL survives a backend container restart
