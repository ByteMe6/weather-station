# Step 4 — PRD (Product Requirements Document)

---

## User Quotes

| #   | User                                                   | Quote                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Weather enthusiast (Telegram/Instagram community host) | "Meteostation project is going to be designed to capture live data of pressure, humidity, rain intensity (in milliliters), wind speed and direction. With this data, my severe weather research team that I host on Telegram and Instagram can get live information and compare it to the information that services like Ventusky and others provide for more precise warnings about weather events." |

---

## Goals

- Deliver accurate, hyperlocal weather data to users whose nearest public station is too far away to be useful.
- Make the experience turnkey: a non-technical user should be able to register their device and see live readings within 10 minutes.
- Enable automated Telegram alerts so schools and institutions can notify students of weather conditions without any manual daily effort.

## Non-Goals

- Weather forecasting or prediction of any kind.
- Supporting more than one weather station per user account (post-MVP).
- Native mobile app (iOS / Android).
- Home automation integrations (HomeKit, Google Home, MQTT).
- Certified or calibrated meteorological accuracy — this is hobby/institutional grade.
- Snow measurement, cellular/LoRa fallback, or battery/deep-sleep firmware optimisation.

---

## Functional Requirements

### ESP32 Firmware

| ID | Requirement |
|----|-------------|
| F1 | Read BME280 sensor: temperature (°C), relative humidity (%), atmospheric pressure (hPa). |
| F2 | Read anemometer via Hall sensor A3144: compute wind speed (km/h) from pulse frequency. |
| F3 | Read wind vane via KY-040 rotary encoder: derive wind direction (0–360°). |
| F4 | Read rain gauge via Hall sensor A3144: count bucket-tip pulses, report precipitation (mm). |
| F5 | Obtain current timestamp via NTP; attach to every reading payload. |
| F6 | POST readings to the backend over HTTPS, including a `device-id` header. Retry on transient failure; drop after 3 retries rather than buffering indefinitely. |
| F7 | Firmware is configured at flash time with WiFi credentials and a device-id (no runtime pairing screen required). |

### Backend (Next.js — Vercel)

| ID | Requirement |
|----|-------------|
| B1 | API endpoint `POST /api/readings` — validate `device-id` against the `devices` table, reject unknown IDs with 401. Persist valid readings to the `readings` table in Supabase. |
| B2 | Server actions for web app sensitive operations: device registration (creates or updates entry in `device_users` with role=owner), device sharing (adds users to `device_users`), account settings changes. No REST API endpoints exposed for the web frontend. |
| B3 | The backend does **not** serve read endpoints for sensor data. The web app and Telegram bot query Supabase directly via their respective clients; RLS enforces data isolation at the database layer. |

### Web App (Next.js Frontend — Vercel)

| ID | Requirement |
|----|-------------|
| W1 | Authentication via Clerk (email/password + OAuth). Unauthenticated users are redirected to sign-in. |
| W2 | Device registration page: user enters their device-id and confirms via server action; backend adds them to `device_users` with role=owner. Device sharing: user can add other Clerk user IDs or Telegram IDs to share access; they are added to `device_users` with a configurable role (owner/viewer). |
| W2b | Telegram account linking page: user can link their Telegram ID to their account (optional). Unlinking is always possible. Once linked, Telegram bot can identify the user without `/register` command. |
| W3 | Dashboard: display the latest reading for all active sensors (temperature, humidity, pressure; wind speed and direction; precipitation). Subscribe to Supabase Realtime channel on `device_id`; new readings appear instantly when device posts data. |
| W4 | Historical charts: line charts per parameter using Chart.js with time-range selector (24 h / 7 days / 30 days). |
| W5 | CSV export: user picks a date range and downloads a file containing all readings within that range via server action. |
| W6 | Alert management (if Telegram ID is linked): user can create, edit, delete scheduled alerts. Alerts fire at specified times on specified days; managed via web UI instead of (or in addition to) bot commands. |
| W7 | If no device is registered, show a prompt to register one instead of an empty dashboard. |

### Telegram Bot (TypeScript)

| ID | Requirement |
|----|-------------|
| T1 | `/start` — greet the user and explain registration. |
| T2 | `/menu` — display inline buttons for main actions: "Current", "Alerts", "Register Device", "About" (for users who haven't linked their Telegram ID via the web app). Via callback queries, user can navigate sub-menus without typing text commands. |
| T3 | `/register <device-id>` — link the Telegram account to the given device-id. Confirm success or surface errors (already linked, unknown ID). Can also be initiated via `/menu` → "Register Device" button. Not needed if Telegram ID is already linked via the web app. |
| T4 | `/current` — return the latest reading from the user's registered device within 2 s. Also accessible via `/menu` → "Current" button. |
| T5 | Alerts menu (via `/menu` → "Alerts"): inline buttons to add/list/remove alert slots — for users managing alerts via bot. Users who linked their Telegram ID via web app can manage alerts there instead, but bot commands remain available. |
| T6 | Alert messages include: temperature, humidity, pressure, wind speed/direction, precipitation. |
| T7 | Alerts fire within 60 s of the configured time. |

### Database (Supabase)

| ID | Requirement |
|----|-------------|
| D1 | `users` table: `id`, `clerk_user_id` (nullable), `telegram_id` (nullable), `created_at`. |
| D2 | `devices` table: `device_id` (PK), `status` (unregistered/registered), `created_at`. All device-ids are logged here at flash time with status=unregistered; upon user registration, status changes to registered and an entry is added to `device_users`. |
| D2b | `device_users` table (junction): `device_id` (FK → devices), `user_id` (FK → users), `role` (owner/viewer/editor), `added_at`. Allows multiple users to access the same device with different permission levels. |
| D3 | `readings` table: `id`, `device_id` (FK → devices), `timestamp`, `temperature`, `humidity`, `pressure`, `wind_speed`, `wind_direction`, `precipitation`. |
| D4 | `schedules` table: `id`, `user_id` (FK → users), `time` (HH:MM), `days` (array or bitmask), `created_at`. |
| D5 | Row Level Security policies: RLS ensures each user can only access devices they are linked to in `device_users`. Both web app (Clerk identity) and Telegram bot (TG account identity) authenticate via their respective ID; RLS joins to `device_users` to determine access. |

---

## Success Metrics

| Metric            | Target                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Data latency      | A new reading appears on the dashboard instantly (< 1 s) after the ESP32 posts it via Supabase Realtime.                |
| Bot response time | `/current` responds within 2 s end-to-end.                                                 |
| Alert timeliness  | Scheduled alerts fire within 60 s of the configured time, measured over a 7-day period.    |
| Data isolation    | RLS verified: authenticated user A cannot retrieve any row owned by user B.                |
| Onboarding time   | A new user with a flashed device can reach live data on the dashboard in under 10 minutes. |
| Uptime            | Backend and web app available ≥ 99% of the time (Vercel SLA).                              |

---

## Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| Security | All ESP32-to-backend traffic is HTTPS only. `device-id` is validated server-side on every write. Clerk JWTs are validated on every authenticated API call. Supabase RLS is the final data-isolation backstop. |
| Authentication | Web: Clerk (session token). Bot: Telegram user ID (extracted from incoming update, not user-supplied). Device: opaque device-id header. |
| Privacy / Compliance | Collect only what is needed (sensor readings, user identifiers). Users can delete their account and all associated data on request (right to erasure). No sensor data is shared publicly. Privacy policy required before launch. |
| Performance | Dashboard uses Supabase Realtime WebSocket subscriptions for instant updates. Bot response p95 < 2 s. |
| Scale | MVP targets a single device per user, single-region Vercel deployment. Database indexing on `(device_id, timestamp DESC)` for efficient range queries. |
| Reliability | ESP32 drops readings after 3 failed retries rather than queuing indefinitely. Backend is stateless (Vercel functions); session state lives in Clerk and Supabase. |

---

## Key User Flows

### Flow 1 — Web Onboarding
1. User visits the app → redirected to Clerk sign-in.
2. User creates account and is returned to the dashboard.
3. Dashboard shows "No device registered" prompt → user clicks "Register device".
4. User enters their `device-id` (found on the device label or flashed config) → backend links it → success message.
5. If ESP32 is powered on, first reading appears within 15 s.

### Flow 2 — Telegram Onboarding
1. User opens bot → `/start` → bot explains registration.
2. User sends `/register <device-id>` → bot confirms the link.
3. User sends `/current` → bot returns the latest readings.
4. User sends `/alert add 07:30 Mon,Tue,Wed,Thu,Fri` → bot confirms the schedule.

### Flow 3 — Daily Web Use
1. User logs in → lands on dashboard with live readings.
2. User clicks "7 days" on a chart to see the historical trend.
3. User clicks "Export CSV" → selects date range → downloads file.

### Flow 4 — Daily Bot Use
1. Bot sends the scheduled alert at the configured time with current conditions.
2. User optionally sends `/current` for an on-demand check.

### Flow 5 — Alert Management
1. User sends `/alert list` → sees all scheduled slots.
2. User sends `/alert remove 07:30` → bot confirms removal.

---

## Open Questions & Assumptions

| #   | Question / Assumption                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ1 | **How is the device-id assigned?** Assumption: generated once at flash time (e.g. UUID derived from ESP32 chip ID), logged to the `devices` table with status=unregistered, and printed on device label. No runtime display or pairing button required for MVP. When user registers, status changes to registered and user is linked via `device_users`.                                                                                                                |
| OQ2 | **What happens if WiFi goes down on the ESP32?** Assumption for MVP: readings are dropped (no local buffering). Post-MVP: implement local buffering via LittleFS (~10–20 readings max); older readings are overwritten. Retry transmission when WiFi recovers.                                                                                                                                                          |
| OQ3 | **Dual-auth accounts:** a user could register via Clerk on the web *and* via Telegram. Assumption: the same device-id cannot be linked to two different user accounts; a user who wants both interfaces must link once and the system resolves the identity from either auth method. The exact UX for this is an open question. |
| OQ4 | **Bot deployment:** Railway is the preferred host for the Telegram bot. Assumption: Railway provides sufficient uptime for the alert scheduling use case. VPS is the fallback.                                                                                                                                                  |
| OQ5 | **Reading retention:** How long are sensor readings stored? No policy defined yet — could become a cost driver if readings accumulate at high frequency. Decision needed before launch.                                                                                                                                         |
| OQ6 | **Sensor sampling rate:** The firmware posting interval is not yet specified. Every 60 s is a reasonable default; this affects database row growth and must align with OQ5.                                                                                                                                                     |
| OQ7 | **MVP alert time zones:** Telegram bot scheduled alerts — do they fire in UTC or in the user's local time zone? The bot has no time-zone context by default. Assumption for MVP: alerts fire in UTC; the user is responsible for offsetting. A time-zone setting is post-MVP.                                                   |
