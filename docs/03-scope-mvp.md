# Step 3 — Scope / MVP

## System Architecture

![architecture.md](architecture.md)

---

## In Scope

### ESP32 Firmware
- Read BME280 sensor: temperature, humidity, atmospheric pressure
- Read anemometer via Hall sensor (A3144): wind speed
- Read wind vane via rotary encoder (KY-040): wind direction
- Read rain gauge via Hall sensor (A3144): precipitation (rain only)
- Obtain timestamps via NTP
- Send readings to Next.js backend over HTTPS with `device-id` header (no user auth on device)

### Backend (Next.js API routes — hosted on Vercel)
- Receive readings from ESP32, validate `device-id`, persist to Supabase
- Handle device registration (link `device-id` to `user-id`) from both the web app and the Telegram bot
- Handle sensitive operations from the web app that must not go client-side directly to Supabase

### Web App (Next.js frontend — hosted on Vercel)
- Authentication via Clerk
- Device registration flow: user links their ESP32 device-id to their account
- Real-time display of all sensor readings
- Historical charts for each parameter: last 24 h / 7 days / 30 days
- Data export: CSV with selectable date range
- Reads data directly from Supabase via Supabase JS client (RLS enforces user-scoped access)

### Telegram Bot (TypeScript)
- Authentication via Telegram account
- Device registration flow: user links their ESP32 device-id via bot
- `/current` command — returns the latest readings on demand
- Scheduled alerts: user-configurable time slots and days of the week (multiple per day allowed)

### Database (Supabase)
- `users` — linked to Clerk user ID or Telegram account
- `devices` — stores device metadata
- `device_users` — junction table: links users to devices with a role (owner/viewer); allows multiple users per device
- `readings` — sensor data rows, scoped to `device_id`
- `schedules` — alert time slots per user
- Row Level Security (RLS) policies: users access only devices they are linked to in `device_users`

### Infrastructure
- Monorepo with two apps: `web` (Next.js — frontend + backend), `bot` (TypeScript)
- Database: Supabase (managed PostgreSQL — no self-hosted DB container)

---

## Out of Scope

- LoRa / cellular fallback connectivity (WiFi only)
- Support for multiple simultaneous weather stations per user
- Mobile app (iOS / Android)
- Home-automation integrations (HomeKit, Google Home, MQTT)
- Weather forecasting
- Public API for third-party consumers
- Calibration tools or certified meteorological accuracy
- Snow measurement (rain only; post-MVP)

---

## MVP

The smallest version that proves the core flow end-to-end:

1. **ESP32** reads the BME280 (temperature, humidity, pressure — no wind or rain yet) and POSTs readings to the backend over HTTPS with its `device-id`.
2. **Next.js API route** validates the device-id, stores readings in Supabase.
3. **Web app** (Next.js + Clerk auth) shows current readings and a 24-hour chart; user must be logged in and have registered their device.
4. **Telegram bot** responds to `/current`, provides `/menu` for quick access, and sends scheduled alerts. Alert management can be done via bot commands or (if Telegram ID is linked in web app) via web UI.

Wind / rain sensors, 7-day / 30-day charts, CSV export, and full multi-slot scheduling are confirmed in scope but deferred to the phase after MVP is working end-to-end.

### Acceptance Criteria
- A new reading appears on the dashboard within 15 s of the ESP32 sending it
- `/current` responds within 2 s
- Scheduled alert fires within 1 min of the configured time
- Data in Supabase is not accessible to other users (RLS verified)
- Data survives a Vercel cold start
