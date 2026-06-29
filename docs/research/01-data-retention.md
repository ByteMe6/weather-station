# Data Retention Research

## Question

How long should raw sensor readings be kept, and what happens to older data?

---

## Storage Volume Estimate

- Upload interval: 5 minutes → **288 rows/day** per device
- Rows per year: 288 × 365 = **105,120 rows**
- Row size: ~28 bytes of sensor data + PostgreSQL overhead ≈ **~280 bytes/row**
- Annual storage: ~29 MB/year (including index overhead)

Supabase Free tier provides **500 MB total** database storage.  
500 MB ÷ 29 MB ≈ **~17 years** of single-device raw data — raw storage is not a concern.

---

## Comparison: Retention Approaches

| Approach | Pros | Cons |
|----------|------|------|
| Keep all raw data forever | Simple, no data loss | Grows unbounded; row count slows queries over time |
| Delete raw after N months, no archive | Simple cleanup | Loses all historical granularity |
| Delete raw after N months + daily aggregates permanently | Bounded raw table; long-term trends preserved | Requires nightly job |

---

## TimescaleDB (Considered, Rejected)

TimescaleDB provides automatic hypertable partitioning and built-in data tiering. However, **Supabase deprecated TimescaleDB on PostgreSQL 17** (current default as of 2024). New projects cannot use it. Alternative: pg_partman — but for MVP scale (single device, ~100k rows/year), partitioning is unnecessary overhead.

---

## Decision

**Keep full 5-minute resolution for 12 months.**  
A nightly pg_cron job:
1. Aggregates the previous day's raw rows into `readings_daily` (avg/min/max per parameter, total precipitation).
2. Deletes raw rows older than 12 months.

`readings_daily` is kept **permanently** as a long-term archive.

pg_cron is natively supported on **all Supabase tiers including Free**.

---

## Database Tables

**`readings`** — raw data, 12-month rolling window:
```
id, device_id, timestamp (TIMESTAMPTZ), temperature, humidity, pressure,
wind_speed, wind_direction, precipitation
```
Index on `(device_id, timestamp DESC)` for efficient range queries.

**`readings_daily`** — permanent daily aggregates:
```
day (DATE), device_id,
avg_temp, min_temp, max_temp,
avg_humidity, min_humidity, max_humidity,
avg_pressure, min_pressure, max_pressure,
avg_wind_speed, max_wind_speed,
total_precipitation
```
