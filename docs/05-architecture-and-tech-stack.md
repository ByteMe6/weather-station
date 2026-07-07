# Step 5 & 6 — Architecture & Tech Stack

## System Architecture

![architecture.md](architecture.md)

---

## Device → DB: Security

The device never talks to the DB directly — its only path is `POST /api/readings` on the backend.

```mermaid
flowchart LR
    Device["Device\nholds: device-id\n(no DB credentials,\nno Supabase keys)"]
    TLS["HTTPS / TLS\nno plaintext traffic"]
    Validate["Backend validates\ndevice-id against\ndevices table\nunknown → 401"]
    Write["Backend writes via\nserver-side service key\ninsert-only into readings"]
    RLS["RLS\ndevice-id grants zero\nread access to any data"]

    Device --> TLS --> Validate --> Write --> RLS
```

- `device-id` is an opaque UUID generated at flash time (derived from the ESP32 chip ID) — effectively a bearer credential, unguessable.
- The device can only **write**; it cannot read anything back. Even a leaked device-id exposes no user data — worst case is spoofed readings for that one device.
- Post-MVP hardening (if needed): per-device secret + HMAC signature over the payload, so a sniffed device-id alone is useless.

---

## Device WiFi Connection (Boot Process)

WiFi credentials and device-id are baked in at **flash time** — no pairing screen or captive portal in MVP (PRD F7).

```mermaid
flowchart TD
    Boot["Power on"] --> Cfg["Load flash-time config\nSSID · password · device-id\nSEND_INTERVAL_MS"]
    Cfg --> Conn{"Connect\nto WiFi"}
    Conn -->|fail| Retry["retry with backoff"] --> Conn
    Conn -->|ok| NTP["NTP sync\n(timestamps)"]
    NTP --> Loop["Read sensors\nevery 5 min"]
    Loop --> Send{"POST reading\nover HTTPS"}
    Send -->|ok| Loop
    Send -->|fail ×3| Drop["drop reading\n(no buffering in MVP)"] --> Loop
    Loop -->|WiFi lost| Conn
```

Post-MVP options: captive-portal setup (WiFiManager-style AP) for changing WiFi without reflashing; LittleFS local buffering for offline gaps (PRD OQ2).

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
      HTTPS only
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
      Monorepo · npm workspaces
      web / bot / firmware
```
