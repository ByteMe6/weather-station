# Sensor Sampling Rate Research

## Question

How often should the ESP32 upload readings to the backend?

---

## Industry Standards

**WMO (World Meteorological Organization) — WMO-No.8:**
- Sustained wind speed: 10-minute averages required
- Temperature, pressure, humidity: ≥5-minute averages (sensor time constant ~20 s)
- Sub-5-minute uploads provide no additional meteorological value for these parameters

---

## Commercial Station Reference Points

| Station | Internal Sampling | Cloud Upload |
|---------|------------------|--------------|
| Davis Vantage Pro2 | Every 2.5 s | 1–15 min (user configurable) |
| Netatmo | Every 5 min | Hard-limited to 10 min |
| Ambient Weather WS-2902 | Every 16 s | Every 60 s (Weather Underground) |

Davis samples fast internally for local display but archives at minutes-level to cloud — consistent with WMO guidance.

---

## ESP32 WiFi Duty Cycle

At 5-minute intervals:
- Active time per cycle: ~30 s (WiFi connect + TLS handshake + POST + disconnect)
- Cycle duration: 300 s
- **WiFi duty cycle: ~10%** — negligible power impact on mains power

At 1-minute intervals: ~50% duty cycle — unnecessary wear and no meteorological benefit.

---

## Supabase Realtime Behavior

Each INSERT to the `readings` table triggers a Supabase Realtime WebSocket push to connected clients within **~50–200 ms**. The dashboard feels live regardless of upload interval — a 5-minute gap between readings is a data property, not a latency problem.

---

## Decision

**5-minute upload interval for all parameters.**

`SEND_INTERVAL_MS = 300000` — configurable at flash time.

Rationale:
- Matches WMO lower bound for temperature/pressure/humidity
- Matches WMO standard for wind (10 min) while staying more granular
- 10% WiFi duty cycle on mains power
- Supabase Realtime delivers updates instantly regardless of interval
