# Research: Data Retention Strategy

## Context

The `readings` table receives ~288 rows/day per device (5-minute intervals). We need to decide how long to keep raw data, what to do with older records, and what database tooling to use for managing it.

---

## Part 1 — Approaches to Data Lifecycle Management

Before picking a strategy, the question is: what mechanisms exist for managing time-series data growth in PostgreSQL/Supabase?

### Manual DELETE via pg_cron

Run a scheduled SQL job (e.g., nightly) that deletes rows older than N months. Simple, no extra extensions needed. pg_cron is natively supported on all Supabase tiers including Free.

**Where this works well:** Small-to-medium tables where row count stays manageable. Our case: ~105k rows/year — a `DELETE WHERE timestamp < now() - interval '12 months'` on an indexed column is fast.

**Where this struggles:** At very high row counts (millions), DELETE is slow and generates vacuum load. Not a concern for us at MVP scale.

---

### TimescaleDB hypertables

TimescaleDB extends PostgreSQL with automatic time-based partitioning into "chunks." Old chunks can be dropped (near-instant), compressed, or tiered automatically. The gold standard for time-series in PostgreSQL.

**The problem:** Supabase deprecated TimescaleDB on PostgreSQL 17, which is the current default for all new Supabase projects. You cannot enable it on new projects. Investigated and eliminated.

---

### pg_partman (manual partitioning)

Partition the `readings` table by month using the pg_partman extension. Dropping an old partition is near-instant compared to row-level deletes, and the query planner can skip entire partitions for range queries.

**Where this helps:** Tables with tens of millions of rows where DELETE + vacuum cycles are a real operational burden.

**For our use case:** At ~105k rows/year, row-level deletes via pg_cron are perfectly fast. pg_partman adds meaningful setup complexity (partition maintenance, attach/detach logic) for zero practical benefit at MVP scale. Worth revisiting post-MVP if we go multi-device at high volume.

---

### Keep all raw data forever (no lifecycle management)

Never delete anything. Zero operational complexity.

**The problem:** Row count grows without bound. Storage math is fine (~29 MB/year, Supabase Free gives 500 MB total — ~17 years of single-device raw data), but PostgreSQL MVCC and query performance degrade with large tables even with good indexing. More importantly, it's not a decision — it's a deferral that becomes painful later.

---

## Part 2 — Data Retention Strategies

Once we pick a lifecycle mechanism, the next question is what to keep and for how long.

### Strategy A — Keep all raw data forever

No deletes. Full 5-minute resolution for the entire history.

**Upside:** Simplest possible setup. No cron jobs, no aggregation tables.

**Downside:** Table grows forever. See above — the storage is fine but the row count is not. After 5 years: ~525k rows. After 10 years: ~1M rows. Query performance on historical ranges will slow down. This is a problem we're choosing to ignore and then solve later under pressure.

My opinion: a trap. Feels like zero cost now, but you pay later when queries start lagging and you can't easily prune without losing data.

---

### Strategy B — Rolling delete, no archive

Keep raw data for N months, then delete. Nothing else.

**Upside:** Table stays small and fast forever. Very simple.

**Downside:** You permanently destroy historical data. For a weather station, long-term trends are a core feature — comparing this summer to last summer, spotting seasonal patterns, tracking climate drift over years. Deleting all raw data after 12 months without any archive means users lose all historical context. The product becomes less valuable over time.

My opinion: wrong trade-off. Short-term simplicity at the cost of the product's main long-term value.

---

### Strategy C — Rolling raw window + permanent daily aggregates

Keep full 5-minute resolution for 12 months. Nightly pg_cron job:
1. Aggregates the previous day's raw rows into `readings_daily` (avg/min/max per parameter, total precipitation)
2. Deletes raw rows older than 12 months

`readings_daily` is kept permanently as a long-term archive.

**Upside:** Raw table is bounded (~105k rows max, 12 months × 288/day). Long-term trends are preserved. Daily min/max/avg is the standard unit of historical weather analysis — it's what WMO publishes, what climate scientists use, what the user actually wants when looking back 3 years.

**Downside:** More complexity — two tables, a cron job, aggregation SQL, and risk of the cron job failing silently. If the job fails, raw data accumulates or gets deleted without being archived. Needs monitoring or at least alerting.

My opinion: the right trade-off. The complexity is manageable and the trade-off (lose sub-daily granularity after 12 months) maps well to how historical weather data is actually consumed.

---

## Part 3 — Comparison

| | Keep forever | Rolling delete | Rolling + daily aggregates |
|---|---|---|---|
| Raw table size | Grows forever | Bounded | Bounded |
| Long-term history | Full | None | Daily resolution |
| Operational complexity | Zero | Low | Medium |
| Risk | Future query degradation | Data loss | Cron job failure |
| Storage on Supabase Free | ~17 years before limit | Never hits limit | Never hits limit |
| Suitable for weather app | No | No | Yes |

---

## Part 4 — Summary and Decision

**TimescaleDB** — unavailable on Supabase PG17. Eliminated.

**pg_partman** — adds complexity with no benefit at our data volume. Eliminated for MVP.

**Keep all raw data forever** — deferred decision that becomes a real problem over years. Eliminated.

**Rolling delete with no archive** — destroys the product's long-term value. Eliminated.

**Decision: Strategy C — rolling 12-month raw window + permanent `readings_daily` aggregates via pg_cron.**

Managed with simple `DELETE` + `INSERT INTO readings_daily` SQL in a nightly pg_cron job. No extensions needed, works on Supabase Free, keeps the raw table bounded, and preserves long-term trends at daily granularity.
