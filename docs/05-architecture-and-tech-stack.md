# Step 5 & 6 — Architecture & Tech Stack

## System Architecture

![architecture.md](architecture.md)

---

## Device → DB: Security

The device never talks to the DB directly — its only path is `POST /api/v1/readings` on the backend.

```mermaid
flowchart LR
    Device["Device\nholds: device-id + device secret\n(no DB credentials,\nno Supabase keys)"]
    TLS["HTTPS / TLS\nno plaintext traffic"]
    Sign["Payload signed:\nHMAC-SHA256(secret,\nbody + timestamp)"]
    Validate["Backend validates\ndevice-id + verifies HMAC\ntimestamp window → no replay\ninvalid → 401"]
    Write["Backend writes via\nserver-side service key\ninsert-only into readings"]
    RLS["RLS\ndevice grants zero\nread access to any data"]

    Device --> TLS
    Device --> Sign --> Validate --> Write --> RLS
```

- Every device is flashed with two values: a public `device-id` (printed on the label, used for registration) and a **`device_secret`** (never leaves the device, never shown to the user).
- Each `POST /api/v1/readings` carries an **HMAC-SHA256 signature** of the payload + timestamp, computed with the secret. The backend recomputes and compares; the timestamp window rejects replayed requests.
- The `v1` in that path is a **major** version and moves only on a breaking contract change. Devices are flashed with the full URL, so backwards-compatible revisions are published as an OpenAPI `info.version` semver bump (`1.0.1`) and never move the path. Docs for each served version live at `/api/{version}/docs`.
- The device-id on the label is therefore **not** a credential — knowing it lets you register the device, but not spoof its readings.
- The device can only **write**; it cannot read anything back. No Supabase keys on the device — the backend writes server-side.

---

## Device WiFi Connection (Provisioning + Boot Process)

**Hard constraint:** this is a physical device shipped to a customer. Once it leaves us, we cannot re-flash it, and we cannot ask the customer to send it back. Two consequences, both **in MVP**:

1. **WiFi credentials are entered by the customer, not flashed by us** — we don't know their network at manufacture time, and they may change routers later. Setup is a captive portal (WiFiManager-style).
2. **The very first shipped firmware includes OTA updates** — it's the only way to fix a bug in the field.

Only the identity is flashed at manufacture: `device-id` (printed on the label) + `device_secret`. No network config in firmware.

**Customer setup (first boot, or after WiFi reset):**

1. Customer powers on the device. It has no saved WiFi, so it starts as its own access point: hotspot named `WeatherStation-<id>`.
2. Customer connects to that hotspot with a phone; the setup page opens automatically (captive portal).
3. The page lists nearby WiFi networks; customer picks their home network and enters its password.
4. Device saves the credentials to flash storage (NVS — survives power loss), stops the hotspot, and joins the home network.
5. Done — from now on every boot goes straight to the normal cycle below. A reset button (hold 5 s) wipes saved WiFi and returns to step 1 (e.g. customer moves or changes router).

**Normal operation (every boot after setup):**

1. Load saved WiFi credentials from NVS; load `device-id` + `device_secret` from firmware.
2. Join the home network (station mode). On failure — retry with increasing delay (5 s → 10 s → 30 s → 60 s, forever). The device never bricks; readings just pause until WiFi is back.
3. Sync clock via NTP (needed for reading timestamps and the HMAC anti-replay window).
4. Check for a signed OTA firmware update; install and reboot if one is published.
5. Main loop: every 5 minutes read sensors → sign payload → POST over HTTPS. Failed POST retries 3×, then that reading is dropped (no buffering in MVP — PRD OQ2). WiFi lost → back to step 2.

```mermaid
flowchart TD
    Boot["Power on"] --> HasCreds{"Saved WiFi\nin NVS?"}

    HasCreds -->|no · first boot or after reset| AP["Start own hotspot\nWeatherStation-&lt;id&gt;"]
    AP --> Portal["Customer connects with phone\ncaptive portal opens\npicks network + enters password"]
    Portal --> Save["Save credentials to NVS\nstop hotspot"] --> Conn

    HasCreds -->|yes| Conn{"Join home WiFi\n(station mode)"}
    Conn -->|fail| Retry["retry: 5s → 10s → 30s → 60s\nforever"] --> Conn
    Conn -->|connected| NTP["NTP clock sync"]
    NTP --> OTA["Check signed OTA update\ninstall + reboot if available"]
    OTA --> Loop["Every 5 min:\nread sensors → sign → POST"]
    Loop -->|"POST failed 3× → drop reading"| Loop
    Loop -.->|WiFi lost| Conn
    Loop -.->|"reset button held 5 s\nwipe WiFi"| AP
```

---

## Data Model

```mermaid
erDiagram
    users ||--o{ device_users : "has access via"
    devices ||--o{ device_users : "shared through"
    devices ||--o{ readings : "produces"
    devices ||--o{ readings_daily : "aggregated into"
    users ||--o{ schedules : "configures"

    users {
        uuid id PK
        text clerk_user_id "nullable"
        bigint telegram_id "nullable"
        timestamptz created_at
    }
    devices {
        text device_id PK
        text secret "HMAC key, service-role access only"
        text status "unregistered | registered"
        timestamptz created_at
    }
    device_users {
        text device_id FK
        uuid user_id FK
        text role "owner | editor | viewer"
        timestamptz added_at
    }
    readings {
        bigint id PK
        text device_id FK
        timestamptz timestamp
        float temperature
        float humidity
        float pressure
        float wind_speed
        float wind_direction
        float precipitation
    }
    readings_daily {
        date day PK
        text device_id FK
        float avg_min_max_temp "and humidity, pressure"
        float avg_max_wind_speed
        float total_precipitation
    }
    schedules {
        bigint id PK
        uuid user_id FK
        time time
        text days "bitmask / array"
    }
```

---

## Telegram Bot Commands

```mermaid
flowchart LR
    Bot(("Telegram\nbot"))

    Bot --> Start["/start\ngreet + explain registration"]
    Bot --> Register["/register &lt;device-id&gt;\nlink TG account to device"]
    Bot --> Current["/current\nlatest readings, &lt; 2 s"]
    Bot --> Menu["/menu\ninline buttons"]

    Menu --> MCurrent["Current"]
    Menu --> MAlerts["Alerts"]
    Menu --> MRegister["Register Device"]
    Menu --> MAbout["About"]

    MAlerts --> AAdd["add slot\ntime + days of week"]
    MAlerts --> AList["list slots"]
    MAlerts --> ARemove["remove slot"]

    Scheduler["pg_cron scheduler"] -.->|"fires alert within 60 s\nof configured time"| Bot
```

---

## Tech Stack

```mermaid
mindmap
  root((Weather<br/>Station))
    Firmware
      ESP32 · WiFi on-chip
      PlatformIO · Arduino core
      HTTPS only
      WiFiManager · captive portal setup
      signed OTA updates
    Web + Backend · Vercel
      Next.js App Router
      Clerk auth
      Recharts charts
      Supabase JS client + Realtime
    Database · Supabase
      Managed Postgres
      RLS policies
      pg_cron · alerts + retention
    Telegram Bot
      TypeScript · grammY
      Supabase Edge Functions
      webhook mode
    Repo
      Monorepo · Yarn 4 workspaces + turbo
      apps / packages / infra / firmware
```
