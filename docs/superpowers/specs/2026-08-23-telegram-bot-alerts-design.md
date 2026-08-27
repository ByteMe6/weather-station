# Telegram Bot & Alerts (Phase 3, MVP) — Design

Date: 2026-08-23
Tickets: MRP-18, MRP-20, MRP-21, MRP-23, MRP-24, MRP-26, MRP-28
References: `docs/04-prd.md` (T1–T7, D1–D4, OQ3/OQ4/OQ7, Flows 2/4/5),
`docs/03-scope-mvp.md` (MVP acceptance criteria)

Completing this phase completes the MVP: every Phase 3 Linear ticket is
currently Todo, and everything ships as **one branch / one PR**
(`mrp-18-telegram-bot-alerts`) whose description references all seven ticket
IDs so Linear links and closes them on merge.

## Decisions (agreed 2026-08-23)

1. **Alert-add UX**: stateless-hybrid — text commands work directly, the
   Alerts menu drives the same flow with inline buttons; multi-step state is
   persisted in a Supabase `bot_sessions` table (no in-memory state, no
   external store).
2. **Timezone (OQ7)**: infer + override — bot-created slots default to the
   user's most recent existing slot's timezone, else UTC (stated explicitly in
   the confirmation); an optional trailing IANA argument overrides.
3. **Multi-device users**: `/current` and alert messages show one block per
   linked device (sharing shipped in Phase 6, so membership, not ownership,
   decides visibility).
4. **Delivery**: all tickets in a single PR; internal build order still
   follows the ticket dependency chain.
5. **Hosting**: stays on Supabase Edge Functions + grammY per PRD OQ4. The
   Vercel Chat SDK was considered and rejected — it targets Node/Vercel
   hosting and would contradict the OQ4 consolidation decision.

## Architecture

Two halves, both on Supabase:

- **Interactive bot** — the existing `telegram-bot` edge function (webhook
  mode, `X-Telegram-Bot-Api-Secret-Token` validated, `verify_jwt = false`)
  grows a command + callback router. Covers T1–T5.
- **Alert dispatcher** — a new `alert-dispatcher` edge function invoked every
  minute by pg_cron via pg_net. Covers T6/T7.

```
infra/supabase-db/supabase/functions/
  telegram-bot/
    index.ts        — bot wiring + webhook handler (exists; slims down)
    link.ts         — MRP-37 deep-link flow (unchanged)
    identity.ts     — telegram_id → users row (create if absent)
    session.ts      — bot_sessions helpers (typed state union, TTL)
    commands/
      start.ts, menu.ts, register.ts, current.ts, alerts.ts
  _shared/
    db.ts           — service-role client factory (extracted from link.ts)
    readings.ts     — linked devices + latest reading per device
    format.ts       — T6 message formatting (bot and dispatcher share it)
  alert-dispatcher/
    index.ts        — cron-secret check → claim due slots → send → record
```

`_shared/` is the standard Supabase cross-function folder; both functions
deploy via `yarn deploy:functions` (script extended to deploy both).

The bot authenticates users by the Telegram ID taken from the incoming
update — never from message text — and uses the service-role client, so every
query checks `device_users` membership (or `schedules.user_id`) explicitly in
code, exactly like a server action.

## Data model

### Migration 1 — `bot_sessions`

```sql
create table public.bot_sessions (
  telegram_id bigint primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);
```

- RLS enabled; **zero grants to anon/authenticated** (service-role only).
  pgTAP proves client roles are refused.
- State is a typed TS union in `session.ts`:
  - `{ kind: 'awaiting_device_id' }` (menu-driven registration)
  - `{ kind: 'awaiting_alert_time', days: number[] }` (menu-driven alert add)
- TTL 10 minutes: expired rows are treated as absent and deleted on next
  touch; no cron cleanup needed at this scale.
- Plain-text message precedence in the bot: command handlers first, then a
  live session consumes the text, otherwise the unknown-input hint.

### Migration 2 — dispatcher

- `create extension pg_cron; create extension pg_net;`
- Delivery ledger + idempotency guard:

```sql
create table public.alert_deliveries (
  id bigint generated always as identity primary key,
  schedule_id bigint not null
    references public.schedules (id) on delete cascade,
  fire_date date not null,          -- the occurrence's LOCAL date
  status text not null default 'claimed'
    check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (schedule_id, fire_date)
);
```

  Service-role only, same posture as `bot_sessions`. The unique constraint's
  index also serves the FK (leading column), so no extra index is needed.

- `claim_due_alert_slots()` — `SECURITY DEFINER`, empty `search_path`,
  EXECUTE granted to service_role only. Returns
  `(schedule_id, user_id, telegram_id, slot_time, timezone, fire_date)`.
  Matching rules:
  - A slot is **due** when the user-local timestamp
    (`now() AT TIME ZONE s.timezone`) falls in
    `[candidate_date + s.time, candidate_date + s.time + 5 minutes)` and
    `extract(isodow from candidate_date)` is in `s.days`.
  - **Both candidate local dates** (today and yesterday) are checked so the
    5-minute catch-up window works across midnight (a 23:58 slot claimed at
    00:01 records `fire_date` = yesterday).
  - Only users with `telegram_id is not null` qualify (web-only users see
    web alerts later; nothing to send to Telegram).
  - Claim is atomic: `insert into alert_deliveries … on conflict do nothing
    returning`, joined back — a slot occurrence can be claimed exactly once
    (T7 "never double-fires").
  - DST: fall-back repeats can't double-fire (unique key); a spring-forward
    slot inside the skipped hour does not fire that day — accepted and
    documented here.
- `invoke_alert_dispatcher()` — small `SECURITY DEFINER` function that reads
  `alert_dispatcher_url` and `alert_cron_secret` from Vault and issues
  `net.http_post(url, headers => {'x-cron-secret': …}, body => '{}')`.
  EXECUTE revoked from all client roles.
- Cron job, versioned in the migration:
  `select cron.schedule('alert-dispatcher-tick', '* * * * *', $$select public.invoke_alert_dispatcher()$$);`

### Secrets

One `CRON_SECRET`, stored in two homes like `admin_org_id`:

- Vault (`alert_cron_secret`, plus `alert_dispatcher_url`) for the SQL side —
  written by a new `yarn cron:set-secret` script mirroring `admin:set-org`.
- Edge-function secret (`CRON_SECRET`) for verification in
  `alert-dispatcher` — `npx supabase secrets set`, documented in
  `supabase/functions/.env.example`.

`[functions.alert-dispatcher] verify_jwt = false` in `config.toml`; the
custom header check is the gate (the new `sb_secret` keys are not JWTs).

## Bot behavior (T1–T5)

- **`/start`** (T1) — greeting + how registration works; the existing
  `link_` deep-link branch stays first.
- **`/menu`** (T2) — inline keyboard: Current / Alerts / Register Device /
  About. Callback data is namespaced (`menu:*`, `alerts:*`, `register:*`);
  every screen has Back; buttons that need a linked device reply with a
  register prompt instead of an error. About briefly describes the project.
  Unknown commands and unhandled text → hint pointing to `/menu`.
- **`/register <device-id>`** (T3) — upsert `users` by `telegram_id`,
  lowercase the id (provisioning CLI stores lowercase), call the existing
  `claim_device()` RPC and map its errors:
  `DEVICE_NOT_FOUND` → "unknown device id",
  `DEVICE_ALREADY_CLAIMED` → "already linked to another account" (OQ3),
  own device → friendly idempotent "already registered".
  Menu path: "Register Device" sets `awaiting_device_id`, next message is
  the id.
- **`/current`** (T4) — user → `device_users` → all linked devices → latest
  reading per device (single `(device_id, timestamp DESC)` indexed lookup
  each). One block per device: nickname (device profile) or device id,
  "as of HH:MM (n min ago)" in the user's inferred timezone, values per T6
  with unavailable sensors as "—". No device → register prompt; no readings
  → "no data yet". Target p95 < 2 s measured in MRP-28.
- **Alerts** (T5) — both surfaces read/write the same `schedules` rows as the
  web UI (MRP-42):
  - Text: `/alert add HH:MM <days> [tz]` (days = comma list and/or ranges of
    3-letter English names, e.g. `Mon,Wed` / `Mon-Fri`; optional IANA zone),
    `/alert list` (numbered, time + days + zone), `/alert remove <n>` where
    `n` is the list's number (slots ordered by time asc, then id — the same
    ordering `list` renders, so the two commands agree). Menu removal uses
    the schedule id in callback data and is immune to reordering.
  - Menu: Alerts → Add → inline day-toggle keyboard (selection encoded in
    callback data) → Done → `awaiting_alert_time` session → user sends
    `HH:MM` → saved. List renders slots with numbered Remove buttons; Remove
    asks for confirmation.
  - Multiple slots per day allowed (no artificial uniqueness).
  - Timezone default per Decision 2; the confirmation always names the
    resolved zone and mentions the override.
  - Validation: `HH:MM` 24-hour format, at least one day, IANA zone checked
    via `Intl.supportedValuesOf('timeZone')`. Every failure has a specific
    message — no silent failures.

## Dispatcher behavior (T6/T7)

Per tick: verify `x-cron-secret` (constant-time compare) →
`claim_due_alert_slots()` → for each claimed slot: fetch the user's linked
devices + latest readings, format the shared T6 message (temperature,
humidity, pressure, wind speed/direction, precipitation; missing values shown
as unavailable; wind direction rendered as a compass point), `sendMessage`
via the Bot API, then mark the delivery `sent` or `failed` (+ error text).
Each slot is wrapped in its own try/catch: a blocked bot or network error is
recorded and never breaks other users' alerts. The function returns a
summary (claimed/sent/failed counts) for the function logs.

## Testing

- **Deno unit tests** (`deno test` added to CI beside `deno check` /
  `deno lint`): alert argument parsing (times, day lists/ranges, zones),
  callback-data codec, session TTL logic, register error mapping, T6
  formatting with nulls, compass-point conversion.
- **pgTAP** (`yarn test:db`): privilege posture of `bot_sessions` and
  `alert_deliveries` (client roles refused); `claim_due_alert_slots()`
  matrix — timezone match, day-of-week, window edges, midnight wrap, second
  claim returns nothing; `invoke_alert_dispatcher` not executable by client
  roles; cron job registered. Assertions via `select ok(...)`, all rows
  covered.
- **rls-reviewer agent** run after each migration (project rule).
- **MRP-28 E2E** (phase exit): scripted checklist — Flow 2 fresh-account
  onboarding; `/current` p95 < 2 s over ≥ 20 invocations; Flow 5 add / list
  / remove via menu; alert content vs T6; a second Telegram account can
  neither register nor read a claimed device. The multi-day alert-timeliness
  measurement (every fire within 60 s) necessarily runs against the deployed
  bot after merge; the PR ships the measurement query
  (`alert_deliveries.created_at` vs configured slot time) and the checklist,
  findings are written up afterwards and bugs filed as new tickets.

## Delivery

- Branch `mrp-18-telegram-bot-alerts` off `dev`; internal commit order
  follows the dependency chain (scaffold → menus/sessions → register →
  current → alerts → dispatcher → E2E harness).
- One PR. Description lists: `Closes MRP-18`, `Closes MRP-20`,
  `Closes MRP-21`, `Closes MRP-23`, `Closes MRP-24`, `Closes MRP-26`, and
  `Refs MRP-28` (closed manually once the post-deploy timing measurement is
  done).
- `yarn regenerate:types` after each migration; `yarn lint`,
  `yarn check-types`, `yarn test:unit`, `yarn test:db`, `deno check`,
  `deno lint`, `deno test` all green before the PR.
- MRP-18 note for Linear: the function lives in
  `infra/supabase-db/supabase/functions/` (repo convention), not `apps/bot`
  as the ticket text assumed.

## Out of scope / known risks

- **MRP-39 (dual-auth identity, OQ3)**: `/register` creating telegram-only
  `users` rows is compatible with the future merge design but does not
  implement it.
- **MRP-36** later reuses the pg_cron extension this phase enables.
- **DST spring-forward**: a slot inside the skipped local hour does not fire
  that day (documented above).
- **Cold starts** could threaten the 2 s `/current` p95 — measured in
  MRP-28 before any mitigation is considered.
- **Local pg_net → edge runtime wiring** (container-to-host URL) is a
  dev-environment detail; `cron:set-secret` writes a local-appropriate
  `alert_dispatcher_url`, documented in the script.
