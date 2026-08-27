# Phase 3 verification — Telegram bot & alerts (MRP-28)

Exit checklist for PRD Flows 2/4/5 and the Phase 3 success metrics.
Local items were run against the local stack before the PR; the deploy
items and the multi-day timeliness measurement run against production
after merge, then MRP-28 closes.

## Deploy prerequisites (prod)

- [x] `yarn deploy:functions` (deploys telegram-bot + alert-dispatcher)
- [x] `npx supabase secrets set CRON_SECRET=…` and
      `yarn cron:set-secret <prod-url> <same-secret>`
- [x] BotFather `/setcommands`: start, menu, register, current, alert
- [ ] **MRP-39 merge shipped** — `supabase db push` (migration
      `20260827221145_merge_telegram_identity`) **then** `yarn deploy:functions`
      again for the rewritten `link.ts`. Flow 2 below cannot be verified until
      this lands: linking a Telegram account that already talked to the bot
      previously dead-ended on the `users.telegram_id` unique index, which is
      what forced the manual SQL merge on this project's own account.

## Flow 2 — onboarding (fresh Telegram account)

- [ ] /start explains registration
- [ ] /register <device-id> links and confirms
- [ ] /current returns live readings from the device
- [ ] /menu buttons: Current / Alerts / Register Device / About all
      navigate; Back works

## /current latency (success metric: p95 < 2 s)

- [ ] ≥ 20 invocations timed (stopwatch or Telegram client timestamps);
      record all timings here, compute p95

## Flow 5 — alert management

- [ ] add via text: /alert add 07:30 Mon-Fri
- [ ] add via menu: day picker → Done → time
- [ ] /alert list matches; remove (text + button, with confirmation) works
- [ ] invalid time / days / timezone each produce a specific error

## Alert timeliness (success metric: within 60 s, measured over several days)

Run after deploy with 3+ slots across timezones/days:

```sql
select s.id, s.time, s.timezone, d.fire_date, d.status,
       d.created_at,
       d.created_at - ((d.fire_date + s.time) at time zone s.timezone) as lag
from alert_deliveries d
join schedules s on s.id = d.schedule_id
order by d.created_at desc;
```

- [ ] every row: status = sent, lag between 0 and 60 s
- [ ] alert content lists all six T6 parameters (missing sensors →
      unavailable)

## Isolation

- [ ] second Telegram account: /register of the claimed device →
      "already linked"
- [ ] second account /current does not show the first account's device

## Local pre-PR verification (2026-08-23)

Run with `npx supabase functions serve` against the local stack, dummy
`BOT_TOKEN`, real local DB:

- [x] Dispatcher rejects a wrong `x-cron-secret` with 403
- [x] Tick with a due slot: `{"claimed":1,"sent":0,"failed":1}` — the claim
      RPC fired, the Telegram send failed only because of the dummy token
      (404), and the failure was recorded as
      `alert_deliveries.status = 'failed'` with the error text
- [x] Immediate second tick: `{"claimed":0,...}` — the
      `(schedule_id, fire_date)` guard prevents a double fire
- [x] pgTAP matrix (13 files, 164 tests): timezone match, day-of-week,
      5-minute window edges, midnight wrap, idempotent claim, privilege
      posture, cron job registration
- [x] `deno test` (23 tests), `deno check` both functions, `deno lint`

## Prod verification (MRP-28)

All read-only SQL below lives in
`infra/supabase-db/supabase/verification/phase-3-metrics.sql`, numbered to
match these sections. Every query was executed against the local stack on
2026-08-27 to prove it parses and returns the right shape — the numbers still
have to come from production.

Run the whole file at once:

```bash
cat infra/supabase-db/supabase/verification/phase-3-metrics.sql \
  | npx supabase db query --linked        # or paste into Studio → SQL editor
```

### Automated — run against prod 2026-08-27 22:26 UTC

Results below are from the live project (`hgsarpsjhniznafhgkjn`) via the
Management API query endpoint.

| § | Check | Result |
| --- | --- | --- |
| 1b | alert timeliness | **NO DATA — 0 schedules, 0 deliveries.** See finding F1. |
| 1c | late/failed deliveries | zero rows (vacuous — nothing has fired) |
| 2 | double-fire guard | zero rows (vacuous) |
| 3 | isolation | **pass** — both registered devices have exactly 1 owner; no registered device lacks one |
| 4 | identity health | **pass** — linked_both 1, web_only 2, telegram_only 0, **orphaned 0** |
| 5 | `/current` plan | **pass** — `Index Scan using readings_device_id_timestamp_idx`, execution **0.114 ms** |
| 6 | cron | **pass** — `alert-dispatcher-tick`, `* * * * *`, active; 55/55 runs succeeded, latest 22:26:00 |

Device inventory at that moment:

| device_id | status | owners | readings | last reading (UTC) |
| --- | --- | --- | --- | --- |
| `ws-2153a69eb973` | registered | 1 | 2692 | 2026-08-27 20:15:49 |
| `ws-7d046e5d9829` | registered | 1 | 0 | — |
| `ws-6367f8397153` | unregistered | 0 | 0 | — |

§5 covers only the database half of the `/current` p95 metric, and it is
effectively free (0.114 ms). Whatever the end-to-end p95 turns out to be is
edge-function cold start plus the Telegram round trip, not the query.

### Automated — re-run after the blockers below clear

- [ ] **§1b alert timeliness** — `within_60s` equals `total`, `failed` is 0,
      and `days_observed` ≥ 3 (the metric is "measured over several days").
      `worst_lag` is the number to quote.
- [ ] **§1c** returns zero rows (no late or failed delivery).
- [ ] **§2 double-fire guard** returns zero rows.
- [ ] **§3 isolation** — both queries return zero rows: no device has two
      owners, no registered device lacks one.
- [ ] **§4 identity health** — `orphaned` is 0; §4b returns zero rows.
- [ ] **§5 `/current` plan** — `Index Scan using readings_device_id_timestamp_idx`.
      Verified locally: index-served, 0.009 ms execution. (The `Seq Scan on
      devices` in that plan is only the `limit 1` helper picking a device id,
      not part of the real `/current` path.)
- [ ] **§6 cron** — `alert-dispatcher-tick` is `active`, `* * * * *`, and the
      last 20 runs all read `succeeded`. Verified locally: 8/8 succeeded.

### Manual — needs a second Telegram account and a stopwatch

These cannot be measured from SQL; they need a real chat.

- [ ] **Flow 2, fresh Telegram account** (one that has never messaged the bot):
      `/start` → `/register <device-id>` → `/current` returns live readings.
- [ ] **`/current` p95 < 2 s** over ≥ 20 invocations. Time from sending to the
      reply appearing; Telegram's own message timestamps are the cheapest
      record. Paste all 20 timings, then the p95.
- [ ] **Flow 5** — add via text (`/alert add 07:30 Mon-Fri`), add via the menu
      (day picker → Done → time), `/alert list` matches, remove via text and
      via button-with-confirmation.
- [ ] **Invalid input** — bad time, bad days, bad timezone each produce their
      own specific error, not a generic one.
- [ ] **Alert content** lists all six T6 parameters, with missing sensors shown
      as unavailable (wind/rain are still unavailable until Phase 4).
- [ ] **Isolation, second account** — `/register` of the claimed device answers
      "already linked"; `/current` does not show the first account's device.
- [ ] **MRP-39 merge, in the chat** — from an account that already had its own
      stations via the bot: link it from the web and confirm the reply names
      what moved ("I brought 1 station and 2 alerts…"), the stations appear on
      the web dashboard, and §4 shows no orphaned row afterwards.

## Findings

### F1 — the alert success metric has no data (blocks MRP-28)

`schedules` and `alert_deliveries` are both **empty in production**. The
dispatcher is healthy — cron has fired every minute, 55/55 succeeded — but it
has never had a slot to dispatch. The headline Phase 3 metric ("every alert
within 60 s of its configured time, measured over several days") therefore
cannot be evaluated at all yet.

To clear it: create at least 3 slots across different timezones/days on a
linked account, then let them run for 3+ days and re-run §1b/§1c. Nothing in
the code is suspected here; there is simply nothing to measure.

### F2 — the live device has been degrading for two days

`ws-2153a69eb973` held a clean 5-minute cadence (288 readings/day) through
2026-08-25, then fell off:

| day | readings | expected |
| --- | --- | --- |
| 2026-08-21 | 251 | 288 |
| 2026-08-22 | 278 | 288 |
| 2026-08-23 | 285 | 288 |
| 2026-08-24 | 287 | 288 |
| 2026-08-25 | **288** | 288 |
| 2026-08-26 | 195 | 288 |
| 2026-08-27 | 57 | 288 |

At 22:26 UTC it had been silent for **2 h 10 m** (last reading 20:15:49). The
gap immediately before that was 6 m 09 s against a 5-minute interval, i.e. a
retry, not a clean stop.

This blocks the "`/current` returns **live** readings" acceptance criterion and
the 20-invocation p95 measurement — both need the station actually reporting.
Cause not yet established: could be WiFi, power, the NTP/HTTPS retry-drop path
(MRP-15), or the upstream network. Worth its own ticket rather than being
absorbed into MRP-28.

### F3 — MRP-39 deployed to production (resolved 2026-08-27 22:45 UTC)

Prod identity state was already clean before the deploy (orphaned 0,
telegram_only 0), so the earlier manual SQL merge did hold.

Verified after deploy:

| Check | Result |
| --- | --- |
| `merge_telegram_identity` exists | yes |
| `telegram_merge_result` type exists | yes |
| latest applied migration | `20260827221145` |
| `security definer` | yes |
| `search_path` | pinned to `""` |
| volatility | `VOLATILE` (correct — it mutates) |
| `service_role` may execute | yes |
| `anon` may execute | **no** |
| guard smoke test | `merge_telegram_identity('…00ff', 999999999)` → `P0001 USER_NOT_FOUND`, nothing mutated |

`notify pgrst, 'reload schema'` was issued afterwards so PostgREST — the path
the bot's `rpc()` call actually takes — cannot serve a stale schema cache.

**Deploy-order hazard, recorded for next time.** The edge functions were
deployed *before* the migration, leaving prod for ~4 minutes with a
`telegram-bot` v2 that called a function the database did not have. Linking
failed with the generic "Could not link right now." — and because
`handleLinkCode` consumes the one-time code *before* calling the RPC, every
attempt in that window burned a code. `yarn deploy:functions` uploads the
**working tree**, not a commit, so this can happen with nothing committed.
Migration first, functions second.
