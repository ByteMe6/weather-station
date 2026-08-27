# Phase 3 verification — Telegram bot & alerts (MRP-28)

Exit checklist for PRD Flows 2/4/5 and the Phase 3 success metrics.
Local items were run against the local stack before the PR; the deploy
items and the multi-day timeliness measurement run against production
after merge, then MRP-28 closes.

## Deploy prerequisites (prod)

- [ ] `yarn deploy:functions` (deploys telegram-bot + alert-dispatcher)
- [ ] `npx supabase secrets set CRON_SECRET=…` and
      `yarn cron:set-secret <prod-url> <same-secret>`
- [ ] BotFather `/setcommands`: start, menu, register, current, alert

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

## Findings

(record results; file new tickets for bugs)
