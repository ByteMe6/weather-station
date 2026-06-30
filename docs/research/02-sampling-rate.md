# Research: Sensor Upload Interval

## Context

The ESP32 wakes its WiFi radio, connects to the backend, and POSTs a reading on a configurable timer (`SEND_INTERVAL_MS`). We need to decide how often. This affects data granularity, WiFi power draw, row volume in the database, and how "live" the dashboard feels.

---

## Part 1 — Factors That Constrain the Decision

Before comparing specific intervals, it's worth understanding what actually limits how short the interval can usefully be.

### Sensor time constants

The BME280 sensor (temperature, humidity, pressure) has a thermal time constant of approximately 20 seconds. This means consecutive readings taken less than 20 s apart are not meaningfully different — the sensor hasn't had time to react to real changes in the environment. Sampling faster than the sensor's response time produces correlated noise, not new information.

Wind speed and direction can change faster, but averaging is required anyway — WMO standard is a 10-minute average for sustained wind speed.

### WiFi connection overhead

Each upload cycle on the ESP32 requires: WiFi radio on → connect to AP → TLS handshake → HTTP POST → disconnect. This takes approximately 30 seconds per cycle. This is fixed overhead regardless of interval.

- At 1-minute intervals: 30 s active / 60 s total = **50% duty cycle**
- At 5-minute intervals: 30 s active / 300 s total = **10% duty cycle**
- At 10-minute intervals: 30 s active / 600 s total = **5% duty cycle**

On mains power this matters less, but the unnecessary radio activity shortens hardware lifespan and increases interference.

### Dashboard latency vs. upload interval

Supabase Realtime pushes each INSERT to connected dashboard clients within ~50–200 ms. This means the dashboard feels live regardless of upload interval — a new reading appears the moment it arrives, not on a polling schedule. A 5-minute gap between readings is a data property, not a latency problem.

---

## Part 2 — Interval Options

### Option A — Every 1 minute

**Row volume:** 1,440 rows/day, ~525,600 rows/year — 5× more than 5-minute intervals.

**Data quality:** At 1-minute intervals, consecutive temperature/humidity readings differ only by sensor noise, not real environmental change. The data looks more granular but isn't.

**WiFi duty cycle:** ~50%. Unnecessary on mains power.

**My opinion:** High cost (storage, radio wear), no real data quality benefit. The sensors physically can't produce meaningful new information at this rate.

---

### Option B — Every 5 minutes

**Row volume:** 288 rows/day, ~105,120 rows/year.

**Data quality:** Matches WMO lower bound for temperature, pressure, humidity (≥5-minute averages). Wind data at 5-minute intervals is more granular than the WMO 10-minute standard — which is fine, more granular is acceptable, just not necessary.

**WiFi duty cycle:** ~10%.

**Industry reference:** Davis Vantage Pro2 (professional benchmark) archives to cloud at 1–15 min. Netatmo hard-limits uploads to 10 min. Both land at or above 5 minutes.

**My opinion:** The right balance. Matches standards, keeps radio duty cycle low, and Supabase Realtime means the dashboard still feels instant.

---

### Option C — Every 10 minutes

**Row volume:** 144 rows/day, ~52,560 rows/year.

**Data quality:** Matches WMO standard for sustained wind speed. For temperature and pressure, WMO allows ≥5 minutes — 10 minutes is within standard but coarser than needed. A rapid weather event (sudden pressure drop over 7 minutes) would be partially missed.

**WiFi duty cycle:** ~5%.

**My opinion:** Acceptable but unnecessarily coarse. On mains power, going to 5 minutes costs nothing extra and captures events that 10-minute intervals would miss.

---

### Option D — Every 30 minutes or longer

**Row volume:** 48 rows/day or fewer.

**Use case:** Makes sense for battery-powered, deep-sleep designs where every radio-on cycle matters.

**My opinion:** Wrong trade-off for our hardware. We're on mains power; battery is post-MVP. Sacrificing data granularity for power savings that don't apply is not a good trade.

---

## Part 3 — Industry Reference Points

| Product | Internal sampling | Cloud upload |
|---|---|---|
| Davis Vantage Pro2 | Every 2.5 s | 1–15 min (user configurable) |
| Netatmo Smart Weather Station | Every 5 min | Hard-limited to 10 min |
| Ambient Weather WS-2902 | Every 16 s | Every 60 s (Weather Underground) |
| WMO standard (WMO-No.8) | — | ≥5 min (temp / humidity / pressure), 10 min (wind) |

Note: Davis samples fast internally for local display but archives to cloud at minutes-level. This pattern — fast local, slower cloud — validates that cloud upload frequency and sensor sampling frequency are separate concerns. We don't need sub-minute cloud uploads even if we wanted sub-minute local readings.

---

## Part 4 — Comparison

| | 1 minute | 5 minutes | 10 minutes | 30 minutes |
|---|---|---|---|---|
| Rows/year | ~525k | ~105k | ~52k | ~17k |
| WiFi duty cycle | ~50% | ~10% | ~5% | ~2% |
| Matches WMO standard | No | Yes (lower bound) | Yes (wind standard) | No |
| Captures rapid events | Yes | Yes | Partially | No |
| Useful on mains power | No (overkill) | Yes | Yes | No (too coarse) |

---

## Part 5 — Summary and Decision

**1 minute** — sensor physics and WiFi duty cycle rule it out.

**30 minutes** — trade-off only justified by battery power, which is post-MVP.

**10 minutes** — valid, but unnecessarily coarse when 5 minutes has no real cost on mains power.

**Decision: 5-minute upload interval for all parameters** (`SEND_INTERVAL_MS = 300000`, configurable at flash time).

Matches WMO standards, keeps WiFi duty cycle at 10%, database row volume stays manageable (~105k rows/year), and Supabase Realtime makes the dashboard feel instant regardless.
