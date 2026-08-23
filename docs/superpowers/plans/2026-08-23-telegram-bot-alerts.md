# Telegram Bot & Alerts (Phase 3, MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full Telegram bot command surface (T1–T5) and the pg_cron-driven alert dispatcher (T6/T7) as one PR closing MRP-18/20/21/23/24/26 and referencing MRP-28.

**Architecture:** The existing `telegram-bot` Supabase Edge Function (grammY, webhook mode) grows a command + callback router with multi-step state in a new service-role-only `bot_sessions` table. A new `alert-dispatcher` Edge Function is invoked every minute by pg_cron → `invoke_alert_dispatcher()` → pg_net; it claims due slots atomically via `claim_due_alert_slots()` (unique `(schedule_id, fire_date)` in `alert_deliveries` is the double-fire guard) and sends Telegram messages. Command handlers are pure builder functions returning a neutral `Reply` shape; thin grammY glue lives in `index.ts` only, so everything is unit-testable under `deno test` without mocking grammY.

**Tech Stack:** Deno 2 / TypeScript, grammY 1.x, @supabase/supabase-js 2.x (untyped in Deno functions — matches existing `link.ts`), Postgres 15 (pg_cron, pg_net, Vault), pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-23-telegram-bot-alerts-design.md`

## Global Constraints

- Branch `mrp-18-telegram-bot-alerts` (already created, spec committed). One PR at the end; no pushes until Task 9.
- Arrow functions only; `const` over `let`; no `any`; no lint-suppression comments (applies to Deno code too).
- Tests never sit next to source: Deno tests live in `infra/supabase-db/supabase/functions/tests/`, pgTAP in `infra/supabase-db/supabase/tests/`.
- Supabase selects alias snake_case → camelCase in the query string (`deviceId:device_id`), filters/orders stay snake_case, insert payloads snake_case.
- Every write whose success is reported to the user chains `.select()` and checks returned length.
- After every migration: `yarn db-reset:local` then `yarn regenerate:types` (both from `infra/supabase-db/`), and run the **rls-reviewer** agent on the migration.
- All shell commands below run from `infra/supabase-db/` unless stated otherwise; Deno commands run from `infra/supabase-db/supabase/functions/`.
- The Telegram user ID always comes from the update (`ctx.from.id` / claimed slot), never from message text.
- New tables get explicit `grant select, insert, update, delete … to service_role` (the init-migration blanket grant covered only then-existing tables) and zero grants to anon/authenticated.
- Commit after each green task; commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Restructure the bot scaffold (MRP-18)

Move the Deno config to the functions root so `telegram-bot`, `alert-dispatcher` (Task 8), `_shared/`, and `tests/` share one import map; extract the service-role client factory; stand up `deno test` in CI.

**Files:**
- Move: `infra/supabase-db/supabase/functions/telegram-bot/deno.json` → `infra/supabase-db/supabase/functions/deno.json`
- Move: `infra/supabase-db/supabase/functions/telegram-bot/deno.lock` → `infra/supabase-db/supabase/functions/deno.lock`
- Create: `infra/supabase-db/supabase/functions/_shared/db.ts`
- Modify: `infra/supabase-db/supabase/functions/telegram-bot/link.ts` (use `_shared/db.ts`)
- Test: `infra/supabase-db/supabase/functions/tests/db.test.ts`
- Modify: `.github/workflows/ci.yml` (edge-functions job)

**Interfaces:**
- Produces: `serviceClient(): SupabaseClient` from `_shared/db.ts` — throws `Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set')` when env is missing. Every later task gets its DB client from here.

- [ ] **Step 1: Move the Deno config up one level**

```bash
cd infra/supabase-db/supabase/functions
git mv telegram-bot/deno.json deno.json
git mv telegram-bot/deno.lock deno.lock
```

- [ ] **Step 2: Write the failing test for the client factory**

`tests/db.test.ts`:

```typescript
import { assertThrows } from '@std/assert'

import { serviceClient } from '../_shared/db.ts'

Deno.test('serviceClient throws a pointed error when env is missing', () => {
  const url = Deno.env.get('SUPABASE_URL')
  Deno.env.delete('SUPABASE_URL')
  try {
    assertThrows(
      () => serviceClient(),
      Error,
      'SUPABASE_URL / SUPABASE_SECRET_KEY are not set',
    )
  } finally {
    if (url !== undefined) Deno.env.set('SUPABASE_URL', url)
  }
})
```

Add `"@std/assert": "jsr:@std/assert@^1.0.0"` to the imports in `deno.json` and import it as `@std/assert` (here and in every later test).

- [ ] **Step 3: Run the test to verify it fails**

Run (from `infra/supabase-db/supabase/functions/`): `deno test --allow-env tests/db.test.ts`
Expected: FAIL — module `../_shared/db.ts` not found.

- [ ] **Step 4: Create `_shared/db.ts` and refactor `link.ts`**

`_shared/db.ts` (extracted from `link.ts`, unchanged semantics):

```typescript
// Service-role client for the bot's own DB access (RLS bypassed): every
// caller must scope queries by the Telegram user's identity in code.
import { createClient } from '@supabase/supabase-js'

export const serviceClient = () => {
  const url = Deno.env.get('SUPABASE_URL')
  const key =
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key)
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set')
  return createClient(url, key)
}
```

In `link.ts`: delete the local `createClient` import and `service` factory; add `import { serviceClient } from '../_shared/db.ts'` and replace the one `service()` call with `serviceClient()`.

- [ ] **Step 5: Verify tests and typecheck pass**

Run: `deno test --allow-env tests/` then `deno check telegram-bot/index.ts` then `deno lint`
Expected: all PASS (the lockfile may update after `deno check` — include it in the commit).

- [ ] **Step 6: Update the CI edge-functions job**

In `.github/workflows/ci.yml`, edge-functions job: change `working-directory` to `infra/supabase-db/supabase/functions`, and replace the two run steps with:

```yaml
      - name: Typecheck
        run: deno check telegram-bot/index.ts

      - name: Lint
        run: deno lint

      - name: Unit tests
        run: deno test --allow-env tests/
```

(Task 8 adds `alert-dispatcher/index.ts` to the Typecheck line.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(bot): shared deno config + service client factory, deno test in CI (MRP-18)"
```

---

### Task 2: `bot_sessions` table + session helpers

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_bot_sessions.sql` (via `yarn migrate:new bot_sessions`)
- Create: `infra/supabase-db/supabase/functions/telegram-bot/session.ts`
- Test: `infra/supabase-db/supabase/tests/bot_sessions.sql`
- Test: `infra/supabase-db/supabase/functions/tests/session.test.ts`
- Modify: `infra/supabase-db/src/types/database.ts` (generated)

**Interfaces:**
- Consumes: `serviceClient()` from Task 1.
- Produces (from `session.ts`):
  - `type SessionState = { kind: 'awaiting_device_id' } | { kind: 'awaiting_alert_time'; days: number[] }`
  - `parseSessionState(value: unknown): SessionState | null` (pure)
  - `getSession(db: SupabaseClient, telegramId: number): Promise<SessionState | null>` — expired/invalid rows are cleared and read as null
  - `setSession(db: SupabaseClient, telegramId: number, state: SessionState): Promise<void>` — upsert, `expires_at = now + 10 min`
  - `clearSession(db: SupabaseClient, telegramId: number): Promise<void>`

- [ ] **Step 1: Create the migration**

Run: `yarn migrate:new bot_sessions`, then fill the generated file:

```sql
-- Multi-step bot flow state (menu-driven register / alert add). The webhook
-- function is stateless between updates, so the pending step lives here.
-- Service-role only: the Telegram identity never reaches a client session.
create table public.bot_sessions (
  telegram_id bigint primary key,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.bot_sessions enable row level security;

-- No policies and no client grants on purpose. The init-migration blanket
-- service_role grant predates this table, so grant explicitly.
grant select, insert, update, delete on public.bot_sessions to service_role;
```

- [ ] **Step 2: Write the pgTAP privilege test**

`supabase/tests/bot_sessions.sql` (mirrors `telegram_link_codes.sql`):

```sql
begin;
select plan(5);

select ok((select relrowsecurity from pg_class where oid = 'public.bot_sessions'::regclass), 'RLS enabled');
select ok(has_table_privilege('service_role', 'public.bot_sessions', 'select, insert, update, delete'), 'service_role has full access');
select ok(not has_any_column_privilege('anon', 'public.bot_sessions', 'select'), 'anon cannot read sessions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_a","role":"authenticated"}', true);
select throws_ok(
  $$ select count(*) from public.bot_sessions $$,
  '42501', null, 'authenticated cannot read sessions'
);
select throws_ok(
  $$ insert into public.bot_sessions (telegram_id, state, expires_at) values (1, '{}'::jsonb, now()) $$,
  '42501', null, 'authenticated cannot insert sessions'
);
select * from finish();
rollback;
```

- [ ] **Step 3: Apply and verify**

Run: `yarn db-reset:local && yarn regenerate:types && yarn test:db`
Expected: all pgTAP files PASS (new file 5/5).

- [ ] **Step 4: Run the rls-reviewer agent on the migration**

Dispatch the `rls-reviewer` agent on the new migration file; fix anything it flags before continuing.

- [ ] **Step 5: Write failing unit tests for the pure state parser**

`tests/session.test.ts`:

```typescript
import { assertEquals } from '@std/assert'

import { parseSessionState } from '../telegram-bot/session.ts'

Deno.test('parseSessionState accepts the two known states', () => {
  assertEquals(parseSessionState({ kind: 'awaiting_device_id' }), {
    kind: 'awaiting_device_id',
  })
  assertEquals(
    parseSessionState({ kind: 'awaiting_alert_time', days: [1, 3, 5] }),
    { kind: 'awaiting_alert_time', days: [1, 3, 5] },
  )
})

Deno.test('parseSessionState rejects malformed values', () => {
  assertEquals(parseSessionState(null), null)
  assertEquals(parseSessionState({ kind: 'nope' }), null)
  assertEquals(parseSessionState({ kind: 'awaiting_alert_time' }), null)
  assertEquals(
    parseSessionState({ kind: 'awaiting_alert_time', days: [0, 8] }),
    null,
  )
  assertEquals(parseSessionState({ kind: 'awaiting_alert_time', days: [] }), null)
})
```

Run: `deno test --allow-env tests/session.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 6: Implement `session.ts`**

```typescript
// Pending multi-step flow state, persisted in bot_sessions (spec §Data model).
import type { SupabaseClient } from '@supabase/supabase-js'

export type SessionState =
  | { kind: 'awaiting_device_id' }
  | { kind: 'awaiting_alert_time'; days: number[] }

const SESSION_TTL_MS = 10 * 60 * 1000

const isDayList = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)

export const parseSessionState = (value: unknown): SessionState | null => {
  if (typeof value !== 'object' || value === null) return null
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'awaiting_device_id') return { kind: 'awaiting_device_id' }
  if (kind === 'awaiting_alert_time') {
    const days = (value as { days?: unknown }).days
    if (isDayList(days)) return { kind: 'awaiting_alert_time', days }
  }
  return null
}

export const getSession = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<SessionState | null> => {
  const { data, error } = await db
    .from('bot_sessions')
    .select('state, expiresAt:expires_at')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) throw new Error(`session read failed: ${error.message}`)
  if (!data) return null
  if (new Date(data.expiresAt as string).getTime() < Date.now()) {
    await clearSession(db, telegramId)
    return null
  }
  return parseSessionState(data.state)
}

export const setSession = async (
  db: SupabaseClient,
  telegramId: number,
  state: SessionState,
): Promise<void> => {
  const { error } = await db.from('bot_sessions').upsert({
    telegram_id: telegramId,
    state,
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`session write failed: ${error.message}`)
}

export const clearSession = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<void> => {
  const { error } = await db
    .from('bot_sessions')
    .delete()
    .eq('telegram_id', telegramId)
  if (error) throw new Error(`session clear failed: ${error.message}`)
}
```

- [ ] **Step 7: Verify tests pass**

Run: `deno test --allow-env tests/` and `deno check telegram-bot/index.ts` and `deno lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(bot): bot_sessions table + session state helpers"
```

---

### Task 3: `/start`, `/menu`, callback router (MRP-20)

Pure builders return a neutral `Reply`; `index.ts` owns the only grammY glue.

**Files:**
- Create: `infra/supabase-db/supabase/functions/telegram-bot/reply.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/commands/menu.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/commands/start.ts`
- Modify: `infra/supabase-db/supabase/functions/telegram-bot/index.ts`
- Test: `infra/supabase-db/supabase/functions/tests/menu.test.ts`

**Interfaces:**
- Produces (from `reply.ts`):
  - `interface Reply { text: string; buttons?: { text: string; data: string }[][] }`
- Produces (from `commands/menu.ts`):
  - `mainMenu(): Reply` — buttons Current / Alerts / Register Device / About with data `menu:current`, `menu:alerts`, `register:start`, `menu:about`
  - `aboutReply(): Reply`, `unknownReply(): Reply`, `backRow(): { text: string; data: string }[]` (one `⬅️ Back` button, data `menu:root`)
- Produces (from `commands/start.ts`): `startReply(): Reply`
- Callback-data namespace (fixed for all later tasks): `menu:root`, `menu:current`, `menu:alerts`, `menu:about`, `register:start`, `alerts:add`, `alerts:day:<7-char bitstring Mon..Sun>`, `alerts:save:<bitstring>`, `alerts:rm:<schedule-id>`, `alerts:rmc:<schedule-id>`.
- `index.ts` produces two helpers later tasks plug into: a `callback_query:data` dispatcher and a `message:text` fallback that (a) consults `getSession` and (b) otherwise sends `unknownReply()`.

- [ ] **Step 1: Write failing tests**

`tests/menu.test.ts`:

```typescript
import { assertEquals, assertMatch } from '@std/assert'

import { aboutReply, mainMenu, unknownReply } from '../telegram-bot/commands/menu.ts'
import { startReply } from '../telegram-bot/commands/start.ts'

Deno.test('mainMenu renders the four T2 buttons with routed callback data', () => {
  const rows = mainMenu().buttons ?? []
  const flat = rows.flat()
  assertEquals(
    flat.map((b) => b.data),
    ['menu:current', 'menu:alerts', 'register:start', 'menu:about'],
  )
})

Deno.test('start explains registration (T1)', () => {
  assertMatch(startReply().text, /\/register/)
})

Deno.test('about and unknown replies point somewhere useful', () => {
  assertMatch(aboutReply().text, /weather/i)
  assertMatch(unknownReply().text, /\/menu/)
})
```

Run: `deno test --allow-env tests/menu.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `reply.ts`, `commands/start.ts`, `commands/menu.ts`**

`reply.ts`:

```typescript
export interface Reply {
  text: string
  buttons?: { text: string; data: string }[][]
}
```

`commands/start.ts`:

```typescript
import type { Reply } from '../reply.ts'

export const startReply = (): Reply => ({
  text: [
    'Hi! I am the Weather Station bot. 🌤',
    '',
    'I report live readings from your weather station and send scheduled alerts.',
    'To connect a station, send /register <device-id> — the id is printed on',
    'the device label. Then /current shows the latest readings and /menu has',
    'everything else.',
  ].join('\n'),
})
```

`commands/menu.ts`:

```typescript
import type { Reply } from '../reply.ts'

export const backRow = (): { text: string; data: string }[] => [
  { text: '⬅️ Back', data: 'menu:root' },
]

export const mainMenu = (): Reply => ({
  text: 'What would you like to do?',
  buttons: [
    [
      { text: '🌡 Current', data: 'menu:current' },
      { text: '⏰ Alerts', data: 'menu:alerts' },
    ],
    [
      { text: '🔗 Register Device', data: 'register:start' },
      { text: 'ℹ️ About', data: 'menu:about' },
    ],
  ],
})

export const aboutReply = (): Reply => ({
  text:
    'Hyperlocal weather monitoring: an ESP32 station measures temperature, ' +
    'humidity, pressure (and, soon, wind and rain) every 5 minutes. This bot ' +
    'shows live readings and sends scheduled alerts. There is a web ' +
    'dashboard too — link your account there to manage everything in one place.',
  buttons: [backRow()],
})

export const unknownReply = (): Reply => ({
  text: 'I did not understand that. Try /menu to see what I can do.',
})
```

- [ ] **Step 3: Wire the router in `index.ts`**

Replace the current `bot.command('start', …)` block with (keep the `link_` branch first, unchanged in behavior):

```typescript
import { InlineKeyboard } from 'grammy'

import { mainMenu, aboutReply, unknownReply } from './commands/menu.ts'
import { startReply } from './commands/start.ts'
import type { Reply } from './reply.ts'
import { serviceClient } from '../_shared/db.ts'
import { getSession } from './session.ts'

const toKeyboard = (reply: Reply): InlineKeyboard | undefined => {
  if (!reply.buttons) return undefined
  const kb = new InlineKeyboard()
  for (const row of reply.buttons) {
    for (const b of row) kb.text(b.text, b.data)
    kb.row()
  }
  return kb
}

const send = (ctx: { reply: (t: string, o?: object) => Promise<unknown> }, r: Reply) =>
  ctx.reply(r.text, { reply_markup: toKeyboard(r) })

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim() ?? ''
  if (payload.startsWith(LINK_PREFIX) && ctx.from) {
    return ctx.reply(
      await handleLinkCode(payload.slice(LINK_PREFIX.length), ctx.from.id),
    )
  }
  return send(ctx, startReply())
})

bot.command('menu', (ctx) => send(ctx, mainMenu()))

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data
  await ctx.answerCallbackQuery()
  if (!ctx.from) return
  if (data === 'menu:root') return send(ctx, mainMenu())
  if (data === 'menu:about') return send(ctx, aboutReply())
  // menu:current / menu:alerts / register:* / alerts:* are wired in Tasks 4-6.
  return send(ctx, unknownReply())
})

bot.on('message:text', async (ctx) => {
  if (!ctx.from) return
  const session = await getSession(serviceClient(), ctx.from.id)
  // Session-consuming branches land in Tasks 4 and 6.
  if (!session) return send(ctx, unknownReply())
  return send(ctx, unknownReply())
})
```

(grammY runs `bot.command` handlers before the generic `message:text` listener, so commands are never swallowed by the fallback.)

- [ ] **Step 4: Verify**

Run: `deno test --allow-env tests/ && deno check telegram-bot/index.ts && deno lint`
Expected: PASS.

- [ ] **Step 5: Smoke-test locally (manual, optional but recommended)**

`npx supabase functions serve telegram-bot --env-file supabase/functions/.env` and drive the webhook with a crafted update, or point a test bot at it via a tunnel; confirm `/start`, `/menu`, About, Back, and an unknown command all answer.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bot): /start, /menu, callback router with inline navigation (MRP-20)"
```

---

### Task 4: `/register` (MRP-21)

**Files:**
- Create: `infra/supabase-db/supabase/functions/telegram-bot/identity.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/commands/register.ts`
- Modify: `infra/supabase-db/supabase/functions/telegram-bot/index.ts`
- Test: `infra/supabase-db/supabase/functions/tests/register.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `SessionState`/`getSession`/`setSession`/`clearSession`, `Reply`, `backRow`.
- Produces (from `identity.ts`): `ensureUserId(db: SupabaseClient, telegramId: number): Promise<string>` — returns `users.id`, inserting `{ telegram_id }` on first contact (23505 race → re-select).
- Produces (from `commands/register.ts`):
  - `registerPrompt(): Reply` — asks for the device id (menu path)
  - `registerDevice(db: SupabaseClient, telegramId: number, rawId: string): Promise<Reply>` — trims + lowercases, pre-checks own membership (idempotent message), else calls `claim_device` RPC and maps errors
  - `mapClaimError(message: string): string` (pure) — `DEVICE_NOT_FOUND` → "I do not know that device id…", `DEVICE_ALREADY_CLAIMED` → "That device is already linked to another account.", anything else → "Could not register right now."

- [ ] **Step 1: Write failing tests**

`tests/register.test.ts`:

```typescript
import { assertMatch } from '@std/assert'

import { mapClaimError, normaliseDeviceId } from '../telegram-bot/commands/register.ts'

Deno.test('claim errors map to friendly messages (OQ3)', () => {
  assertMatch(mapClaimError('DEVICE_NOT_FOUND'), /do not know that device/i)
  assertMatch(mapClaimError('DEVICE_ALREADY_CLAIMED'), /another account/i)
  assertMatch(mapClaimError('connection reset'), /could not register/i)
})

Deno.test('device ids are trimmed and lowercased (provisioning CLI stores lowercase)', () => {
  assertMatch(normaliseDeviceId('  WS-A1B2C3  '), /^ws-a1b2c3$/)
})
```

Run: `deno test --allow-env tests/register.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `identity.ts`**

```typescript
// telegram_id → users.id (PRD T3). The id comes from the update, never text.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ensureUserId = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) throw new Error(`user lookup failed: ${error.message}`)
  if (data) return data.id as string

  const inserted = await db
    .from('users')
    .insert({ telegram_id: telegramId })
    .select('id')
    .single()
  if (!inserted.error) return inserted.data.id as string
  if (inserted.error.code === '23505') {
    // Two updates raced; the row exists now.
    const again = await db
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single()
    if (again.error) throw new Error(`user re-lookup failed: ${again.error.message}`)
    return again.data.id as string
  }
  throw new Error(`user insert failed: ${inserted.error.message}`)
}
```

- [ ] **Step 3: Implement `commands/register.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { backRow } from './menu.ts'

export const normaliseDeviceId = (raw: string): string =>
  raw.trim().toLowerCase()

export const mapClaimError = (message: string): string => {
  if (message.includes('DEVICE_NOT_FOUND'))
    return 'I do not know that device id. Check the label on your station and try again.'
  if (message.includes('DEVICE_ALREADY_CLAIMED'))
    return 'That device is already linked to another account.'
  return 'Could not register right now. Please try again in a minute.'
}

export const registerPrompt = (): Reply => ({
  text: 'Send me the device id (printed on the station label), e.g. ws-a1b2c3.',
  buttons: [backRow()],
})

export const registerDevice = async (
  db: SupabaseClient,
  telegramId: number,
  rawId: string,
): Promise<Reply> => {
  const deviceId = normaliseDeviceId(rawId)
  if (!deviceId)
    return { text: 'Usage: /register <device-id> — the id is on the device label.' }
  const userId = await ensureUserId(db, telegramId)

  const { data: existing, error: memberError } = await db
    .from('device_users')
    .select('role')
    .eq('device_id', deviceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (memberError)
    return { text: 'Could not register right now. Please try again in a minute.' }
  if (existing)
    return {
      text: `✅ ${deviceId} is already registered to you. Try /current.`,
    }

  const { error } = await db.rpc('claim_device', {
    p_device_id: deviceId,
    p_user_id: userId,
  })
  if (error) return { text: mapClaimError(error.message) }
  return {
    text: `✅ Linked! ${deviceId} is now your station. Try /current — and /menu → Alerts to schedule updates.`,
  }
}
```

- [ ] **Step 4: Wire into `index.ts`**

```typescript
import { registerDevice, registerPrompt } from './commands/register.ts'
import { setSession, clearSession } from './session.ts'
```

Add a command handler:

```typescript
bot.command('register', async (ctx) => {
  if (!ctx.from) return
  const db = serviceClient()
  if (!ctx.match?.trim()) {
    await setSession(db, ctx.from.id, { kind: 'awaiting_device_id' })
    return send(ctx, registerPrompt())
  }
  return send(ctx, await registerDevice(db, ctx.from.id, ctx.match))
})
```

In the `callback_query:data` dispatcher, before the fallback:

```typescript
  if (data === 'register:start') {
    await setSession(serviceClient(), ctx.from.id, { kind: 'awaiting_device_id' })
    return send(ctx, registerPrompt())
  }
```

In the `message:text` fallback, replace the placeholder session branch with:

```typescript
  if (session?.kind === 'awaiting_device_id') {
    const db = serviceClient()
    await clearSession(db, ctx.from.id)
    return send(ctx, await registerDevice(db, ctx.from.id, ctx.message.text))
  }
```

- [ ] **Step 5: Verify**

Run: `deno test --allow-env tests/ && deno check telegram-bot/index.ts && deno lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bot): /register links a Telegram account to a device (MRP-21)"
```

---

### Task 5: `/current` + shared readings/format (MRP-23)

**Files:**
- Create: `infra/supabase-db/supabase/functions/_shared/readings.ts`
- Create: `infra/supabase-db/supabase/functions/_shared/format.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/commands/current.ts`
- Modify: `infra/supabase-db/supabase/functions/telegram-bot/index.ts`
- Test: `infra/supabase-db/supabase/functions/tests/format.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `ensureUserId`, `Reply`, `backRow`.
- Produces (from `_shared/readings.ts`):
  - `interface LatestReading { timestamp: string; temperature: number | null; humidity: number | null; pressure: number | null; windSpeed: number | null; windDirection: number | null; precipitation: number | null }`
  - `interface DeviceReading { deviceId: string; label: string | null; reading: LatestReading | null }`
  - `fetchDeviceReadings(db: SupabaseClient, userId: string): Promise<DeviceReading[]>` — all devices the user is linked to via `device_users` (membership check in code — service role bypasses RLS), one indexed latest-row lookup each
  - `inferTimezone(db: SupabaseClient, userId: string): Promise<string>` — most recent `schedules` row's timezone (by `created_at` desc), else `'UTC'`
- Produces (from `_shared/format.ts`):
  - `compassPoint(deg: number): string` (8-point)
  - `formatAge(ts: Date, now: Date): string` — `"just now"` under 60 s, `"n min ago"`, `"n h ago"` from 60 min
  - `formatDeviceBlock(d: DeviceReading, timezone: string, now: Date): string` — heading `📟 <label or deviceId>`, `as of HH:MM <tz> (<age>)`, then per T6 one line each for temperature/humidity/pressure/wind/precipitation, `unavailable` for null sensors, `no data yet` body when `reading` is null
  - `formatCurrentMessage(list: DeviceReading[], timezone: string, now: Date): string` — blocks joined by blank lines
  - `formatAlertMessage(list: DeviceReading[], slot: { time: string; timezone: string }, now: Date): string` — `⏰ Weather alert — <HH:MM> <tz>` header + the same blocks

- [ ] **Step 1: Write failing format tests**

`tests/format.test.ts`:

```typescript
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'

import {
  compassPoint,
  formatAge,
  formatAlertMessage,
  formatCurrentMessage,
  formatDeviceBlock,
} from '../_shared/format.ts'
import type { DeviceReading } from '../_shared/readings.ts'

const NOW = new Date('2026-08-23T12:08:00Z')
const full: DeviceReading = {
  deviceId: 'ws-a1b2c3',
  label: 'Backyard',
  reading: {
    timestamp: '2026-08-23T12:05:00Z',
    temperature: 21.4,
    humidity: 55,
    pressure: 1013,
    windSpeed: 3.2,
    windDirection: 45,
    precipitation: 0.5,
  },
}

Deno.test('compassPoint maps degrees to 8 points', () => {
  assertEquals(compassPoint(0), 'N')
  assertEquals(compassPoint(45), 'NE')
  assertEquals(compassPoint(350), 'N')
  assertEquals(compassPoint(180), 'S')
})

Deno.test('formatAge buckets', () => {
  assertEquals(formatAge(new Date('2026-08-23T12:07:30Z'), NOW), 'just now')
  assertEquals(formatAge(new Date('2026-08-23T12:05:00Z'), NOW), '3 min ago')
  assertEquals(formatAge(new Date('2026-08-23T10:05:00Z'), NOW), '2 h ago')
})

Deno.test('device block shows all six T6 parameters', () => {
  const block = formatDeviceBlock(full, 'UTC', NOW)
  assertStringIncludes(block, 'Backyard')
  assertStringIncludes(block, '21.4 °C')
  assertStringIncludes(block, '55 %')
  assertStringIncludes(block, '1013 hPa')
  assertStringIncludes(block, '3.2 m/s NE')
  assertStringIncludes(block, '0.5 mm')
  assertMatch(block, /as of 12:05 UTC \(3 min ago\)/)
})

Deno.test('missing sensors read as unavailable, missing reading as no data', () => {
  const sparse: DeviceReading = {
    ...full,
    reading: { ...full.reading!, windSpeed: null, windDirection: null, precipitation: null },
  }
  const block = formatDeviceBlock(sparse, 'UTC', NOW)
  assertStringIncludes(block, 'Wind: unavailable')
  assertStringIncludes(block, 'Precipitation: unavailable')
  const empty: DeviceReading = { ...full, reading: null }
  assertStringIncludes(formatDeviceBlock(empty, 'UTC', NOW), 'no data yet')
})

Deno.test('current and alert messages compose blocks', () => {
  assertStringIncludes(formatCurrentMessage([full], 'UTC', NOW), 'ws-a1b2c3')
  const alert = formatAlertMessage([full], { time: '07:30', timezone: 'Europe/Kyiv' }, NOW)
  assertMatch(alert, /^⏰ Weather alert — 07:30 Europe\/Kyiv/)
})
```

Run: `deno test --allow-env tests/format.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `_shared/format.ts`**

```typescript
// T6 message formatting, shared by /current and the alert dispatcher.
import type { DeviceReading } from './readings.ts'

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export const compassPoint = (deg: number): string =>
  POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

export const formatAge = (ts: Date, now: Date): string => {
  const mins = Math.floor((now.getTime() - ts.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)} h ago`
}

const localHHMM = (ts: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(ts)

const line = (label: string, value: string): string => `${label}: ${value}`
const num = (v: number | null, unit: string): string | null =>
  v === null ? null : `${v} ${unit}`

export const formatDeviceBlock = (
  d: DeviceReading,
  timezone: string,
  now: Date,
): string => {
  const name = d.label ?? d.deviceId
  const heading = d.label ? `📟 ${d.label} (${d.deviceId})` : `📟 ${d.deviceId}`
  if (!d.reading) return `${heading}\nno data yet — is ${name} powered on?`
  const ts = new Date(d.reading.timestamp)
  const wind =
    d.reading.windSpeed === null
      ? 'unavailable'
      : `${d.reading.windSpeed} m/s${
          d.reading.windDirection === null
            ? ''
            : ` ${compassPoint(d.reading.windDirection)}`
        }`
  return [
    heading,
    `as of ${localHHMM(ts, timezone)} ${timezone} (${formatAge(ts, now)})`,
    line('🌡 Temperature', num(d.reading.temperature, '°C') ?? 'unavailable'),
    line('💧 Humidity', num(d.reading.humidity, '%') ?? 'unavailable'),
    line('🔽 Pressure', num(d.reading.pressure, 'hPa') ?? 'unavailable'),
    line('💨 Wind', wind),
    line('🌧 Precipitation', num(d.reading.precipitation, 'mm') ?? 'unavailable'),
  ].join('\n')
}

export const formatCurrentMessage = (
  list: DeviceReading[],
  timezone: string,
  now: Date,
): string => list.map((d) => formatDeviceBlock(d, timezone, now)).join('\n\n')

export const formatAlertMessage = (
  list: DeviceReading[],
  slot: { time: string; timezone: string },
  now: Date,
): string =>
  [`⏰ Weather alert — ${slot.time} ${slot.timezone}`, formatCurrentMessage(list, slot.timezone, now)].join('\n\n')
```

- [ ] **Step 3: Implement `_shared/readings.ts`**

```typescript
// Linked devices + latest reading each. Membership is checked in code
// because the service-role client bypasses RLS (project rule).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LatestReading {
  timestamp: string
  temperature: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  precipitation: number | null
}

export interface DeviceReading {
  deviceId: string
  label: string | null
  reading: LatestReading | null
}

export const fetchDeviceReadings = async (
  db: SupabaseClient,
  userId: string,
): Promise<DeviceReading[]> => {
  const { data: memberships, error } = await db
    .from('device_users')
    .select('deviceId:device_id, devices ( label )')
    .eq('user_id', userId)
    .order('added_at', { ascending: true })
  if (error) throw new Error(`device lookup failed: ${error.message}`)

  return Promise.all(
    (memberships ?? []).map(async (m): Promise<DeviceReading> => {
      const deviceId = m.deviceId as string
      const label =
        (m.devices as { label: string | null } | null)?.label ?? null
      const { data: reading, error: readError } = await db
        .from('readings')
        .select(
          'timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation',
        )
        .eq('device_id', deviceId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (readError)
        throw new Error(`reading lookup failed: ${readError.message}`)
      return { deviceId, label, reading: (reading as LatestReading | null) ?? null }
    }),
  )
}

export const inferTimezone = async (
  db: SupabaseClient,
  userId: string,
): Promise<string> => {
  const { data, error } = await db
    .from('schedules')
    .select('timezone')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`timezone lookup failed: ${error.message}`)
  return (data?.timezone as string | undefined) ?? 'UTC'
}
```

- [ ] **Step 4: Implement `commands/current.ts` and wire it**

`commands/current.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

import { fetchDeviceReadings, inferTimezone } from '../../_shared/readings.ts'
import { formatCurrentMessage } from '../../_shared/format.ts'
import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { backRow } from './menu.ts'

export const currentReply = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<Reply> => {
  const userId = await ensureUserId(db, telegramId)
  const devices = await fetchDeviceReadings(db, userId)
  if (devices.length === 0)
    return {
      text: 'No station is linked yet. Send /register <device-id> to connect one.',
      buttons: [[{ text: '🔗 Register Device', data: 'register:start' }], backRow()],
    }
  const timezone = await inferTimezone(db, userId)
  return {
    text: formatCurrentMessage(devices, timezone, new Date()),
    buttons: [backRow()],
  }
}
```

In `index.ts`: `bot.command('current', async (ctx) => { if (!ctx.from) return; return send(ctx, await currentReply(serviceClient(), ctx.from.id)) })`, and in the callback dispatcher add `if (data === 'menu:current') return send(ctx, await currentReply(serviceClient(), ctx.from.id))`.

- [ ] **Step 5: Verify**

Run: `deno test --allow-env tests/ && deno check telegram-bot/index.ts && deno lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(bot): /current — latest readings for every linked device (MRP-23)"
```

---

### Task 6: Alert management (MRP-24)

**Files:**
- Create: `infra/supabase-db/supabase/functions/telegram-bot/alerts-parse.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/schedules.ts`
- Create: `infra/supabase-db/supabase/functions/telegram-bot/commands/alerts.ts`
- Modify: `infra/supabase-db/supabase/functions/telegram-bot/index.ts`
- Test: `infra/supabase-db/supabase/functions/tests/alerts-parse.test.ts`
- Test: `infra/supabase-db/supabase/functions/tests/alerts.test.ts`

**Interfaces:**
- Consumes: `serviceClient`, `ensureUserId`, session helpers, `Reply`, `backRow`, `inferTimezone`.
- Produces (from `alerts-parse.ts`, all pure):
  - `parseTime(raw: string): string | null` — `HH:MM` 24-hour, zero-padded output
  - `parseDays(raw: string): number[] | null` — comma list and/or ranges of case-insensitive 3-letter names (`mon,wed` / `Mon-Fri`), ISO 1–7, sorted unique; null on any bad token, empty result, or backwards range
  - `isValidTimezone(tz: string): boolean` — `Intl.supportedValuesOf('timeZone')` plus `'UTC'`
  - `parseAlertAdd(rest: string): { time: string; days: number[]; timezone?: string } | { error: string }` — grammar `HH:MM <days> [tz]`, each failure names the bad part
  - `daysToBits(days: number[]): string` / `bitsToDays(bits: string): number[]` — 7-char `0|1` string, Mon..Sun (callback-data codec)
  - `formatDays(days: number[]): string` — `"Mon, Wed–Fri"` (collapses runs ≥ 3)
- Produces (from `schedules.ts`):
  - `interface Slot { id: number; time: string; timezone: string; days: number[] }`
  - `listSlots(db, userId): Promise<Slot[]>` — ordered `time` asc then `id` asc; `time` normalised to `HH:MM` (Postgres returns `HH:MM:SS`)
  - `addSlot(db, input: { userId: string; time: string; timezone: string; days: number[] }): Promise<Slot>`
  - `removeSlotById(db, userId: string, id: number): Promise<boolean>` — scoped `.eq('user_id')`, `.select('id')`, length-checked
- Produces (from `commands/alerts.ts`):
  - `alertsMenu(): Reply` — Add (`alerts:add`) / List (`menu:alerts` re-render includes the list) + Back
  - `listReply(slots: Slot[]): Reply` — numbered lines `n. HH:MM tz — days` each with a `🗑 Remove` button (`alerts:rm:<id>`); empty-state text
  - `dayPickerReply(bits: string): Reply` — 7 toggle buttons (`alerts:day:<bits'>` with that day flipped, ✅ prefix when on) + `Done` (`alerts:save:<bits>`) + Back
  - `confirmRemoveReply(slot: Slot): Reply` — `alerts:rmc:<id>` / Back
  - `handleAlertCommand(db, telegramId, rest: string): Promise<Reply>` — routes `add`/`list`/`remove <n>` text grammar
  - `saveSlot(db, telegramId, days: number[], rawTime: string): Promise<Reply>` — validates time, resolves timezone via `inferTimezone`, confirmation names the zone and the override syntax

- [ ] **Step 1: Write failing parser tests**

`tests/alerts-parse.test.ts`:

```typescript
import { assertEquals } from '@std/assert'

import {
  bitsToDays,
  daysToBits,
  formatDays,
  parseAlertAdd,
  parseDays,
  parseTime,
} from '../telegram-bot/alerts-parse.ts'

Deno.test('parseTime accepts 24h HH:MM only', () => {
  assertEquals(parseTime('07:30'), '07:30')
  assertEquals(parseTime('7:30'), '07:30')
  assertEquals(parseTime('23:59'), '23:59')
  assertEquals(parseTime('24:00'), null)
  assertEquals(parseTime('07:60'), null)
  assertEquals(parseTime('0730'), null)
})

Deno.test('parseDays handles lists, ranges, case, dedupe', () => {
  assertEquals(parseDays('Mon,Wed,Fri'), [1, 3, 5])
  assertEquals(parseDays('mon-fri'), [1, 2, 3, 4, 5])
  assertEquals(parseDays('Sat,Sun,sat'), [6, 7])
  assertEquals(parseDays('Mon-Wed,Fri'), [1, 2, 3, 5])
  assertEquals(parseDays('Fri-Mon'), null)
  assertEquals(parseDays('Funday'), null)
  assertEquals(parseDays(''), null)
})

Deno.test('parseAlertAdd grammar with optional timezone', () => {
  assertEquals(parseAlertAdd('07:30 Mon-Fri'), {
    time: '07:30',
    days: [1, 2, 3, 4, 5],
  })
  assertEquals(parseAlertAdd('07:30 Mon-Fri Europe/Kyiv'), {
    time: '07:30',
    days: [1, 2, 3, 4, 5],
    timezone: 'Europe/Kyiv',
  })
  assertEquals('error' in parseAlertAdd('25:00 Mon'), true)
  assertEquals('error' in parseAlertAdd('07:30'), true)
  assertEquals('error' in parseAlertAdd('07:30 Mon Not/AZone'), true)
})

Deno.test('bits codec round-trips', () => {
  assertEquals(daysToBits([1, 3, 5]), '1010100')
  assertEquals(bitsToDays('1010100'), [1, 3, 5])
  assertEquals(bitsToDays(daysToBits([7])), [7])
})

Deno.test('formatDays collapses runs of three or more', () => {
  assertEquals(formatDays([1, 2, 3, 4, 5]), 'Mon–Fri')
  assertEquals(formatDays([1, 3, 4, 5]), 'Mon, Wed–Fri')
  assertEquals(formatDays([6, 7]), 'Sat, Sun')
})
```

Run: `deno test --allow-env tests/alerts-parse.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `alerts-parse.ts`**

```typescript
// Pure parsing/formatting for alert slots (PRD T5, Flow 2/5 grammar).
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const parseTime = (raw: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

const dayIndex = (token: string): number => {
  const i = DAY_NAMES.findIndex(
    (d) => d.toLowerCase() === token.trim().toLowerCase(),
  )
  return i === -1 ? -1 : i + 1
}

export const parseDays = (raw: string): number[] | null => {
  if (!raw.trim()) return null
  const out = new Set<number>()
  for (const token of raw.split(',')) {
    const range = token.split('-')
    if (range.length === 1) {
      const d = dayIndex(range[0])
      if (d === -1) return null
      out.add(d)
    } else if (range.length === 2) {
      const from = dayIndex(range[0])
      const to = dayIndex(range[1])
      if (from === -1 || to === -1 || from >= to) return null
      for (let d = from; d <= to; d++) out.add(d)
    } else return null
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null
}

export const isValidTimezone = (tz: string): boolean =>
  tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz)

export const parseAlertAdd = (
  rest: string,
): { time: string; days: number[]; timezone?: string } | { error: string } => {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2)
    return { error: 'Usage: /alert add HH:MM Mon,Wed or Mon-Fri [Europe/Kyiv]' }
  const time = parseTime(parts[0])
  if (!time) return { error: `"${parts[0]}" is not a valid 24-hour HH:MM time.` }
  const days = parseDays(parts[1])
  if (!days)
    return { error: `"${parts[1]}" is not a valid day list (e.g. Mon,Wed or Mon-Fri).` }
  if (parts.length === 2) return { time, days }
  if (parts.length === 3) {
    if (!isValidTimezone(parts[2]))
      return { error: `"${parts[2]}" is not an IANA timezone (e.g. Europe/Kyiv).` }
    return { time, days, timezone: parts[2] }
  }
  return { error: 'Too many arguments. Usage: /alert add HH:MM <days> [timezone]' }
}

export const daysToBits = (days: number[]): string =>
  DAY_NAMES.map((_, i) => (days.includes(i + 1) ? '1' : '0')).join('')

export const bitsToDays = (bits: string): number[] =>
  [...bits].flatMap((b, i) => (b === '1' ? [i + 1] : []))

export const formatDays = (days: number[]): string => {
  const runs: number[][] = []
  for (const d of days) {
    const last = runs.at(-1)
    if (last && d === last[last.length - 1] + 1) last.push(d)
    else runs.push([d])
  }
  return runs
    .flatMap((run) =>
      run.length >= 3
        ? [`${DAY_NAMES[run[0] - 1]}–${DAY_NAMES[run[run.length - 1] - 1]}`]
        : run.map((d) => DAY_NAMES[d - 1]),
    )
    .join(', ')
}
```

- [ ] **Step 3: Implement `schedules.ts`**

```typescript
// Bot-side access to the shared `schedules` table (same rows as the web UI).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Slot {
  id: number
  time: string
  timezone: string
  days: number[]
}

const toHHMM = (time: string): string => time.slice(0, 5)

export const listSlots = async (
  db: SupabaseClient,
  userId: string,
): Promise<Slot[]> => {
  const { data, error } = await db
    .from('schedules')
    .select('id, time, timezone, days')
    .eq('user_id', userId)
    .order('time', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(`schedule list failed: ${error.message}`)
  return (data ?? []).map((r) => ({ ...(r as Slot), time: toHHMM(r.time as string) }))
}

export const addSlot = async (
  db: SupabaseClient,
  input: { userId: string; time: string; timezone: string; days: number[] },
): Promise<Slot> => {
  const { data, error } = await db
    .from('schedules')
    .insert({
      user_id: input.userId,
      time: input.time,
      timezone: input.timezone,
      days: input.days,
    })
    .select('id, time, timezone, days')
    .single()
  if (error) throw new Error(`schedule insert failed: ${error.message}`)
  return { ...(data as Slot), time: toHHMM(data.time as string) }
}

export const removeSlotById = async (
  db: SupabaseClient,
  userId: string,
  id: number,
): Promise<boolean> => {
  // .select() proves the delete hit a row (project rule: writes must prove it).
  const { data, error } = await db
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(`schedule delete failed: ${error.message}`)
  return (data ?? []).length === 1
}
```

- [ ] **Step 4: Write failing reply-builder tests**

`tests/alerts.test.ts`:

```typescript
import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'

import { dayPickerReply, listReply } from '../telegram-bot/commands/alerts.ts'
import type { Slot } from '../telegram-bot/schedules.ts'

const slots: Slot[] = [
  { id: 7, time: '07:30', timezone: 'Europe/Kyiv', days: [1, 2, 3, 4, 5] },
  { id: 9, time: '19:00', timezone: 'UTC', days: [6, 7] },
]

Deno.test('listReply numbers slots and attaches remove buttons by id', () => {
  const r = listReply(slots)
  assertMatch(r.text, /1\. 07:30 Europe\/Kyiv — Mon–Fri/)
  assertMatch(r.text, /2\. 19:00 UTC — Sat, Sun/)
  const removeData = (r.buttons ?? []).flat().map((b) => b.data)
  assertStringIncludes(removeData.join(' '), 'alerts:rm:7')
  assertStringIncludes(removeData.join(' '), 'alerts:rm:9')
})

Deno.test('listReply has an empty state', () => {
  assertMatch(listReply([]).text, /no alert slots yet/i)
})

Deno.test('dayPickerReply toggles bits and carries them into save', () => {
  const r = dayPickerReply('1010100')
  const flat = (r.buttons ?? []).flat()
  const mon = flat.find((b) => b.text.includes('Mon'))
  assertEquals(mon?.data, 'alerts:day:0010100') // toggling Mon flips bit 1 off
  const done = flat.find((b) => b.data.startsWith('alerts:save:'))
  assertEquals(done?.data, 'alerts:save:1010100')
})
```

Run: `deno test --allow-env tests/alerts.test.ts` — Expected: FAIL.

- [ ] **Step 5: Implement `commands/alerts.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  bitsToDays,
  formatDays,
  isValidTimezone,
  parseAlertAdd,
  parseTime,
} from '../alerts-parse.ts'
import { inferTimezone } from '../../_shared/readings.ts'
import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { addSlot, listSlots, removeSlotById, type Slot } from '../schedules.ts'
import { backRow } from './menu.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const describeSlot = (s: Slot): string =>
  `${s.time} ${s.timezone} — ${formatDays(s.days)}`

export const listReply = (slots: Slot[]): Reply => {
  if (slots.length === 0)
    return {
      text: 'No alert slots yet. Add one and I will message you the weather on schedule.',
      buttons: [[{ text: '➕ Add alert', data: 'alerts:add' }], backRow()],
    }
  return {
    text: [
      'Your alert slots:',
      ...slots.map((s, i) => `${i + 1}. ${describeSlot(s)}`),
    ].join('\n'),
    buttons: [
      ...slots.map((s, i) => [
        { text: `🗑 Remove ${i + 1} (${s.time})`, data: `alerts:rm:${s.id}` },
      ]),
      [{ text: '➕ Add alert', data: 'alerts:add' }],
      backRow(),
    ],
  }
}

export const dayPickerReply = (bits: string): Reply => {
  const toggle = (i: number): string =>
    bits.slice(0, i) + (bits[i] === '1' ? '0' : '1') + bits.slice(i + 1)
  return {
    text: 'Pick the days for this alert, then press Done.',
    buttons: [
      DAY_LABELS.slice(0, 4).map((d, i) => ({
        text: `${bits[i] === '1' ? '✅ ' : ''}${d}`,
        data: `alerts:day:${toggle(i)}`,
      })),
      DAY_LABELS.slice(4).map((d, i) => ({
        text: `${bits[i + 4] === '1' ? '✅ ' : ''}${d}`,
        data: `alerts:day:${toggle(i + 4)}`,
      })),
      [{ text: '✔️ Done', data: `alerts:save:${bits}` }],
      backRow(),
    ],
  }
}

export const confirmRemoveReply = (slot: Slot): Reply => ({
  text: `Remove the ${describeSlot(slot)} alert?`,
  buttons: [
    [{ text: '🗑 Yes, remove it', data: `alerts:rmc:${slot.id}` }],
    backRow(),
  ],
})

const timezoneNote = (tz: string): string =>
  tz === 'UTC'
    ? 'Times are in UTC — append a zone to override, e.g. /alert add 07:30 Mon-Fri Europe/Kyiv'
    : `Times are in ${tz} (from your latest slot) — append a zone to override.`

export const saveSlot = async (
  db: SupabaseClient,
  telegramId: number,
  days: number[],
  rawTime: string,
  timezone?: string,
): Promise<Reply> => {
  const time = parseTime(rawTime)
  if (!time)
    return { text: `"${rawTime}" is not a valid 24-hour HH:MM time. Send e.g. 07:30.` }
  if (timezone && !isValidTimezone(timezone))
    return { text: `"${timezone}" is not an IANA timezone (e.g. Europe/Kyiv).` }
  const userId = await ensureUserId(db, telegramId)
  const tz = timezone ?? (await inferTimezone(db, userId))
  const slot = await addSlot(db, { userId, time, timezone: tz, days })
  return {
    text: `✅ Alert saved: ${describeSlot(slot)}.\n${timezoneNote(tz)}`,
    buttons: [backRow()],
  }
}

export const handleAlertCommand = async (
  db: SupabaseClient,
  telegramId: number,
  rest: string,
): Promise<Reply> => {
  const [sub, ...args] = rest.trim().split(/\s+/).filter(Boolean)
  const userId = await ensureUserId(db, telegramId)
  if (sub === 'list' || sub === undefined) return listReply(await listSlots(db, userId))
  if (sub === 'add') {
    const parsed = parseAlertAdd(args.join(' '))
    if ('error' in parsed) return { text: parsed.error }
    return saveSlot(db, telegramId, parsed.days, parsed.time, parsed.timezone)
  }
  if (sub === 'remove') {
    const n = Number(args[0])
    const slots = await listSlots(db, userId)
    if (!Number.isInteger(n) || n < 1 || n > slots.length)
      return { text: `Usage: /alert remove <n> — n from /alert list (1–${slots.length || 0}).` }
    const removed = await removeSlotById(db, userId, slots[n - 1].id)
    return { text: removed ? `🗑 Removed ${describeSlot(slots[n - 1])}.` : 'That slot is already gone.' }
  }
  return { text: 'Alert commands: /alert add HH:MM <days> [tz], /alert list, /alert remove <n>' }
}
```

- [ ] **Step 6: Wire into `index.ts`**

```typescript
bot.command('alert', async (ctx) => {
  if (!ctx.from) return
  return send(ctx, await handleAlertCommand(serviceClient(), ctx.from.id, ctx.match ?? ''))
})
```

In the callback dispatcher, before the fallback (`db` = `serviceClient()`, `uid` = `ctx.from.id`):

```typescript
  if (data === 'menu:alerts')
    return send(ctx, listReply(await listSlots(db, await ensureUserId(db, uid))))
  if (data === 'alerts:add') return send(ctx, dayPickerReply('0000000'))
  if (data.startsWith('alerts:day:'))
    return send(ctx, dayPickerReply(data.slice('alerts:day:'.length)))
  if (data.startsWith('alerts:save:')) {
    const days = bitsToDays(data.slice('alerts:save:'.length))
    if (days.length === 0)
      return send(ctx, { text: 'Pick at least one day first.' })
    await setSession(db, uid, { kind: 'awaiting_alert_time', days })
    return send(ctx, {
      text: 'Now send the time as HH:MM (24-hour), e.g. 07:30.',
      buttons: [backRow()],
    })
  }
  if (data.startsWith('alerts:rm:')) {
    const id = Number(data.slice('alerts:rm:'.length))
    const slots = await listSlots(db, await ensureUserId(db, uid))
    const slot = slots.find((s) => s.id === id)
    return send(ctx, slot ? confirmRemoveReply(slot) : listReply(slots))
  }
  if (data.startsWith('alerts:rmc:')) {
    const id = Number(data.slice('alerts:rmc:'.length))
    const userId = await ensureUserId(db, uid)
    await removeSlotById(db, userId, id)
    return send(ctx, listReply(await listSlots(db, userId)))
  }
```

In the `message:text` session branch, next to the `awaiting_device_id` case:

```typescript
  if (session?.kind === 'awaiting_alert_time') {
    const db = serviceClient()
    await clearSession(db, ctx.from.id)
    return send(ctx, await saveSlot(db, ctx.from.id, session.days, ctx.message.text.trim()))
  }
```

(Use dynamic edits: prefer `ctx.editMessageText` when responding to callback queries fails gracefully — not required; plain replies are acceptable for MVP.)

- [ ] **Step 7: Verify**

Run: `deno test --allow-env tests/ && deno check telegram-bot/index.ts && deno lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(bot): alert slot add/list/remove via commands and inline menu (MRP-24)"
```

---

### Task 7: Dispatcher DB layer — pg_cron, deliveries, claim RPC (MRP-26)

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_alert_dispatcher.sql` (via `yarn migrate:new alert_dispatcher`)
- Create: `infra/supabase-db/scripts/set-alert-cron.ts`
- Modify: `infra/supabase-db/package.json` (add `cron:set-secret` script)
- Test: `infra/supabase-db/supabase/tests/alert_dispatcher.sql`
- Modify: `infra/supabase-db/src/types/database.ts` (generated)

**Interfaces:**
- Produces: `claim_due_alert_slots(p_now timestamptz default now())` returning `(schedule_id bigint, user_id uuid, telegram_id bigint, slot_time time, slot_timezone text, fire_date date)` — service_role EXECUTE only. `p_now` exists so pgTAP pins deterministic instants; the dispatcher calls it with no argument.
- Produces: `alert_deliveries` (unique `(schedule_id, fire_date)`), `invoke_alert_dispatcher()`, `set_alert_cron_config(p_url text, p_secret text)`, cron job `alert-dispatcher-tick`.
- Produces: `yarn cron:set-secret <url> <secret>`.

- [ ] **Step 1: Create the migration**

Run: `yarn migrate:new alert_dispatcher`, then fill it:

```sql
-- Alert dispatcher (PRD T6/T7, OQ4): pg_cron ticks every minute; the claim
-- RPC finds due slots and the unique (schedule_id, fire_date) is the
-- never-double-fire guard. Local-time matching uses a 5-minute catch-up
-- window checked against BOTH today's and yesterday's local date so a slot
-- near midnight still fires exactly once (spec §Data model).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table public.alert_deliveries (
  id bigint generated always as identity primary key,
  schedule_id bigint not null
    references public.schedules (id) on delete cascade,
  fire_date date not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'sent', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (schedule_id, fire_date)
);
-- The unique constraint's index leads on schedule_id, so it serves the FK;
-- no extra index needed.

alter table public.alert_deliveries enable row level security;
grant select, insert, update, delete on public.alert_deliveries to service_role;
grant usage, select on sequence public.alert_deliveries_id_seq to service_role;

-- Volatile on purpose: the claim mutates alert_deliveries. p_now is
-- parameterised so pgTAP can pin instants (DST, midnight wrap).
create or replace function public.claim_due_alert_slots(p_now timestamptz default now())
returns table (
  schedule_id bigint,
  user_id uuid,
  telegram_id bigint,
  slot_time time,
  slot_timezone text,
  fire_date date
)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select
      s.id as schedule_id,
      s.user_id,
      u.telegram_id,
      s.time as slot_time,
      s.timezone as slot_timezone,
      d.candidate_date as fire_date
    from public.schedules s
    join public.users u on u.id = s.user_id
    cross join lateral (
      select ((p_now at time zone s.timezone)::date - offs) as candidate_date
      from (values (0), (1)) as o (offs)
    ) d
    where u.telegram_id is not null
      and extract(isodow from d.candidate_date)::smallint = any (s.days)
      and (p_now at time zone s.timezone) >= d.candidate_date + s.time
      and (p_now at time zone s.timezone) < d.candidate_date + s.time + interval '5 minutes'
  ),
  claimed as (
    insert into public.alert_deliveries (schedule_id, fire_date)
    select c.schedule_id, c.fire_date from candidates c
    on conflict (schedule_id, fire_date) do nothing
    returning schedule_id, fire_date
  )
  select c.schedule_id, c.user_id, c.telegram_id, c.slot_time, c.slot_timezone, c.fire_date
  from candidates c
  join claimed cl
    on cl.schedule_id = c.schedule_id and cl.fire_date = c.fire_date;
$$;

revoke execute on function public.claim_due_alert_slots(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_due_alert_slots(timestamptz) to service_role;

-- Vault-backed config, written by scripts/set-alert-cron.ts (mirrors
-- set_admin_org_id). Two secrets: dispatcher URL + shared cron secret.
create or replace function public.set_alert_cron_config(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url_id uuid;
  v_secret_id uuid;
begin
  select id into v_url_id from vault.secrets where name = 'alert_dispatcher_url';
  if v_url_id is null then
    perform vault.create_secret(p_url, 'alert_dispatcher_url',
      'Edge-function URL pg_cron posts alert ticks to');
  else
    perform vault.update_secret(v_url_id, p_url);
  end if;
  select id into v_secret_id from vault.secrets where name = 'alert_cron_secret';
  if v_secret_id is null then
    perform vault.create_secret(p_secret, 'alert_cron_secret',
      'Shared secret the alert-dispatcher function requires in x-cron-secret');
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;
end;
$$;

revoke execute on function public.set_alert_cron_config(text, text) from public, anon, authenticated;
grant execute on function public.set_alert_cron_config(text, text) to service_role;

-- The cron tick. Warns (visible in postgres logs) instead of erroring when
-- unconfigured, so a fresh local stack does not fail every minute.
create or replace function public.invoke_alert_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'alert_dispatcher_url';
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'alert_cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'alert dispatcher unconfigured — run: yarn cron:set-secret <url> <secret>';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'x-cron-secret', v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.invoke_alert_dispatcher() from public, anon, authenticated;
grant execute on function public.invoke_alert_dispatcher() to service_role;

-- Versioned job definition (MRP-26 AC). cron.schedule upserts by name, so
-- db resets and re-applies are idempotent.
select cron.schedule(
  'alert-dispatcher-tick',
  '* * * * *',
  $$select public.invoke_alert_dispatcher()$$
);
```

- [ ] **Step 2: Write the pgTAP test**

`supabase/tests/alert_dispatcher.sql`:

```sql
begin;
select plan(12);

-- Fixtures: one Kyiv weekday-morning slot, one UTC slot just before midnight.
insert into public.users (id, telegram_id) values
  ('00000000-0000-0000-0000-0000000000a1', 1001),
  ('00000000-0000-0000-0000-0000000000a2', 1002);
insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a3', 'web_only');
insert into public.schedules (user_id, time, timezone, days) values
  ('00000000-0000-0000-0000-0000000000a1', '07:30', 'Europe/Kyiv', array[1,2,3,4,5]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a2', '23:58', 'UTC', array[1,2,3,4,5,6,7]::smallint[]),
  ('00000000-0000-0000-0000-0000000000a3', '07:30', 'UTC', array[1,2,3,4,5,6,7]::smallint[]);

-- 2026-08-24 is a Monday. 04:30 UTC = 07:30 Kyiv (UTC+3 in August).
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:30:30+00'::timestamptz)) = 1,
  'kyiv slot fires at its local minute'
);
select ok(
  (select count(*) from public.alert_deliveries where status = 'claimed') = 1,
  'claim recorded'
);
select ok(
  (select fire_date from public.alert_deliveries limit 1) = date '2026-08-24',
  'fire_date is the local date'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:31:00+00'::timestamptz)) = 0,
  'second tick does not double-fire (idempotency, T7)'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:36:00+00'::timestamptz)) = 0,
  'window closes after 5 minutes'
);
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-24 04:29:59+00'::timestamptz)) = 0,
  'window does not open early'
);
-- Saturday 2026-08-29 04:30 UTC: Mon-Fri slot must not fire.
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-29 04:30:00+00'::timestamptz)) = 0,
  'day-of-week respected'
);
-- Midnight wrap: 23:58 UTC slot claimed at 00:01 next day, fire_date = previous day.
select ok(
  (select count(*) from public.claim_due_alert_slots('2026-08-25 00:01:00+00'::timestamptz)) = 1,
  'catch-up window crosses midnight'
);
select ok(
  (select count(*) from public.alert_deliveries where fire_date = date '2026-08-24'
     and schedule_id = (select id from public.schedules where time = '23:58')) = 1,
  'midnight-wrap fire_date is the slot''s local date'
);
-- The web-only user (telegram_id null) never claims.
select ok(
  not exists (
    select 1 from public.claim_due_alert_slots('2026-08-24 07:30:30+00'::timestamptz) c
    where c.user_id = '00000000-0000-0000-0000-0000000000a3'
  ),
  'users without telegram_id are skipped'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.alert_deliveries'::regclass),
  'RLS enabled on alert_deliveries'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"web_only","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.claim_due_alert_slots() $$,
  '42501', null, 'clients cannot execute the claim RPC'
);
select * from finish();
rollback;
```

- [ ] **Step 3: Apply and verify**

Run: `yarn db-reset:local && yarn regenerate:types && yarn test:db`
Expected: all files PASS (new file 12/12). If `cron.schedule` fails locally, confirm `pg_cron` is in the local stack (Supabase CLI ships it; no config.toml change needed).

- [ ] **Step 4: Run the rls-reviewer agent on the migration**

Fix anything it flags.

- [ ] **Step 5: Add the config script**

`scripts/set-alert-cron.ts` (mirrors `set-admin-org.ts`):

```typescript
import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env
const [url, secret] = process.argv.slice(2)

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')
}
if (!url?.startsWith('http') || !secret) {
  throw new Error(
    'Usage: yarn cron:set-secret <alert-dispatcher-url> <cron-secret>\n' +
      '  local url:  http://host.docker.internal:54321/functions/v1/alert-dispatcher\n' +
      '  prod url:   https://<project-ref>.supabase.co/functions/v1/alert-dispatcher',
  )
}

// Vault is only reachable with the service-role key. The names are what
// public.invoke_alert_dispatcher() looks up.
const db = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY)

const { error } = await db.rpc('set_alert_cron_config', {
  p_url: url,
  p_secret: secret,
})
if (error) throw new Error(error.message)

console.error(`alert_dispatcher_url + alert_cron_secret set (url: ${url})`)
console.error(
  'Also set CRON_SECRET to the same secret for the function: npx supabase secrets set CRON_SECRET=…',
)
```

Add to `infra/supabase-db/package.json` scripts:

```json
    "cron:set-secret": "node --env-file-if-exists=.env --experimental-strip-types scripts/set-alert-cron.ts",
```

- [ ] **Step 6: Verify workspace checks**

Run (repo root): `yarn lint && yarn check-types`
Expected: PASS (the script is plain TS under the workspace's eslint/tsc).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): pg_cron alert dispatcher plumbing — deliveries ledger + claim RPC (MRP-26)"
```

---

### Task 8: `alert-dispatcher` Edge Function (MRP-26)

**Files:**
- Create: `infra/supabase-db/supabase/functions/alert-dispatcher/dispatch.ts`
- Create: `infra/supabase-db/supabase/functions/alert-dispatcher/index.ts`
- Modify: `infra/supabase-db/supabase/config.toml` (add function block)
- Modify: `infra/supabase-db/package.json` (`deploy:functions` deploys all)
- Modify: `infra/supabase-db/supabase/functions/.env.example` (CRON_SECRET)
- Modify: `.github/workflows/ci.yml` (typecheck the new function)
- Modify: `CLAUDE.md` (bot section: two functions, `deno test`, cron:set-secret)
- Test: `infra/supabase-db/supabase/functions/tests/dispatch.test.ts`

**Interfaces:**
- Consumes: `claim_due_alert_slots` RPC (Task 7), `serviceClient`, `fetchDeviceReadings`, `formatAlertMessage`.
- Produces (from `dispatch.ts`):
  - `interface DueSlot { scheduleId: number; userId: string; telegramId: number; slotTime: string; slotTimezone: string; fireDate: string }`
  - `interface DispatchDeps { claimDueSlots(): Promise<DueSlot[]>; buildMessage(slot: DueSlot): Promise<string>; sendMessage(chatId: number, text: string): Promise<void>; markDelivery(scheduleId: number, fireDate: string, status: 'sent' | 'failed', error?: string): Promise<void> }`
  - `runDispatch(deps: DispatchDeps): Promise<{ claimed: number; sent: number; failed: number }>` — per-slot try/catch; one failure never blocks the rest (T6/T7 reliability AC)

- [ ] **Step 1: Write failing orchestration tests**

`tests/dispatch.test.ts`:

```typescript
import { assertEquals } from '@std/assert'

import { runDispatch, type DueSlot } from '../alert-dispatcher/dispatch.ts'

const slot = (id: number): DueSlot => ({
  scheduleId: id,
  userId: `u${id}`,
  telegramId: 100 + id,
  slotTime: '07:30',
  slotTimezone: 'UTC',
  fireDate: '2026-08-24',
})

Deno.test('sends every claimed slot and marks it sent', async () => {
  const sent: number[] = []
  const marked: [number, string][] = []
  const summary = await runDispatch({
    claimDueSlots: () => Promise.resolve([slot(1), slot(2)]),
    buildMessage: (s) => Promise.resolve(`msg-${s.scheduleId}`),
    sendMessage: (chatId) => {
      sent.push(chatId)
      return Promise.resolve()
    },
    markDelivery: (id, _date, status) => {
      marked.push([id, status])
      return Promise.resolve()
    },
  })
  assertEquals(summary, { claimed: 2, sent: 2, failed: 0 })
  assertEquals(sent, [101, 102])
  assertEquals(marked, [
    [1, 'sent'],
    [2, 'sent'],
  ])
})

Deno.test('one failing send is recorded and does not block others', async () => {
  const marked: [number, string, string | undefined][] = []
  const summary = await runDispatch({
    claimDueSlots: () => Promise.resolve([slot(1), slot(2), slot(3)]),
    buildMessage: (s) => Promise.resolve(`msg-${s.scheduleId}`),
    sendMessage: (chatId) =>
      chatId === 102 ? Promise.reject(new Error('403: bot blocked')) : Promise.resolve(),
    markDelivery: (id, _date, status, error) => {
      marked.push([id, status, error])
      return Promise.resolve()
    },
  })
  assertEquals(summary, { claimed: 3, sent: 2, failed: 1 })
  assertEquals(marked[1], [2, 'failed', '403: bot blocked'])
})
```

Run: `deno test --allow-env tests/dispatch.test.ts` — Expected: FAIL.

- [ ] **Step 2: Implement `dispatch.ts`**

```typescript
// Pure orchestration for one dispatcher tick. All I/O is injected so the
// failure-isolation contract (T7: one blocked bot never breaks the rest)
// is provable in unit tests.
export interface DueSlot {
  scheduleId: number
  userId: string
  telegramId: number
  slotTime: string
  slotTimezone: string
  fireDate: string
}

export interface DispatchDeps {
  claimDueSlots: () => Promise<DueSlot[]>
  buildMessage: (slot: DueSlot) => Promise<string>
  sendMessage: (chatId: number, text: string) => Promise<void>
  markDelivery: (
    scheduleId: number,
    fireDate: string,
    status: 'sent' | 'failed',
    error?: string,
  ) => Promise<void>
}

export const runDispatch = async (
  deps: DispatchDeps,
): Promise<{ claimed: number; sent: number; failed: number }> => {
  const slots = await deps.claimDueSlots()
  let sent = 0
  let failed = 0
  for (const slot of slots) {
    try {
      const text = await deps.buildMessage(slot)
      await deps.sendMessage(slot.telegramId, text)
      await deps.markDelivery(slot.scheduleId, slot.fireDate, 'sent')
      sent++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      try {
        await deps.markDelivery(slot.scheduleId, slot.fireDate, 'failed', message)
      } catch (markErr) {
        // The delivery row stays 'claimed'; log so the trace is not lost.
        console.error('markDelivery failed', { slot: slot.scheduleId, markErr })
      }
    }
  }
  return { claimed: slots.length, sent, failed }
}
```

- [ ] **Step 3: Implement `alert-dispatcher/index.ts`**

```typescript
// Alert dispatcher (PRD T6/T7, OQ4): pg_cron → invoke_alert_dispatcher() →
// this function. Auth is the x-cron-secret header (config.toml sets
// verify_jwt = false; the new sb_secret keys are not JWTs).
import { serviceClient } from '../_shared/db.ts'
import { formatAlertMessage } from '../_shared/format.ts'
import { fetchDeviceReadings } from '../_shared/readings.ts'
import { runDispatch, type DueSlot } from './dispatch.ts'

const token = Deno.env.get('BOT_TOKEN')
if (!token) throw new Error('BOT_TOKEN is not set')
const cronSecret = Deno.env.get('CRON_SECRET')
if (!cronSecret) throw new Error('CRON_SECRET is not set')

const encoder = new TextEncoder()
const digest = async (value: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
// Hash both sides so the comparison cannot leak the secret's length or bytes.
const secretMatches = async (candidate: string | null): Promise<boolean> =>
  candidate !== null && (await digest(candidate)) === (await digest(cronSecret))

const sendTelegramMessage = async (chatId: number, text: string): Promise<void> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) throw new Error(`sendMessage ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (!(await secretMatches(req.headers.get('x-cron-secret')))) {
    return new Response('forbidden', { status: 403 })
  }
  const db = serviceClient()
  const summary = await runDispatch({
    claimDueSlots: async () => {
      const { data, error } = await db.rpc('claim_due_alert_slots')
      if (error) throw new Error(`claim failed: ${error.message}`)
      // rpc() rows cannot be aliased — map snake_case here (project rule).
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): DueSlot => ({
          scheduleId: r.schedule_id as number,
          userId: r.user_id as string,
          telegramId: r.telegram_id as number,
          slotTime: (r.slot_time as string).slice(0, 5),
          slotTimezone: r.slot_timezone as string,
          fireDate: r.fire_date as string,
        }),
      )
    },
    buildMessage: async (slot) => {
      const devices = await fetchDeviceReadings(db, slot.userId)
      if (devices.length === 0)
        return `⏰ Weather alert — ${slot.slotTime} ${slot.slotTimezone}\n\nNo station is linked to your account. Send /register <device-id> to connect one.`
      return formatAlertMessage(
        devices,
        { time: slot.slotTime, timezone: slot.slotTimezone },
        new Date(),
      )
    },
    sendMessage: sendTelegramMessage,
    markDelivery: async (scheduleId, fireDate, status, error) => {
      const { error: updateError } = await db
        .from('alert_deliveries')
        .update({ status, error: error ?? null })
        .eq('schedule_id', scheduleId)
        .eq('fire_date', fireDate)
      if (updateError)
        throw new Error(`delivery update failed: ${updateError.message}`)
    },
  })
  console.log('alert-dispatcher tick', summary)
  return Response.json(summary)
})
```

- [ ] **Step 4: Wire config, deploy script, env docs, CI, CLAUDE.md**

`supabase/config.toml` — append:

```toml
# The dispatcher is called by pg_cron via pg_net with an x-cron-secret
# header (no Supabase JWT), so the gateway must not reject it.
[functions.alert-dispatcher]
verify_jwt = false
```

`infra/supabase-db/package.json`: `"deploy:functions": "npx supabase functions deploy"` (no args = every function in the folder).

`supabase/functions/.env.example` — append:

```
# Shared secret required in x-cron-secret by alert-dispatcher; must equal the
# Vault value written by `yarn cron:set-secret <url> <secret>`.
CRON_SECRET=
```

`.github/workflows/ci.yml` Typecheck step: `run: deno check telegram-bot/index.ts alert-dispatcher/index.ts`

`CLAUDE.md` Telegram bot section: note the second function (`alert-dispatcher`), that `deploy:functions` now deploys both, the `deno test` CI step, and `yarn cron:set-secret`.

- [ ] **Step 5: Verify**

Run: `deno test --allow-env tests/ && deno check telegram-bot/index.ts alert-dispatcher/index.ts && deno lint`
Expected: PASS.

- [ ] **Step 6: Local end-to-end tick (manual)**

```bash
npx supabase functions serve --env-file supabase/functions/.env   # serves both
yarn cron:set-secret http://host.docker.internal:54321/functions/v1/alert-dispatcher local-dev-secret
# with CRON_SECRET=local-dev-secret in supabase/functions/.env:
curl -s -X POST -H 'x-cron-secret: local-dev-secret' \
  http://127.0.0.1:54321/functions/v1/alert-dispatcher
```

Insert a schedules row due "now" for a user with your own telegram_id first; expect a Telegram message and `{"claimed":1,"sent":1,"failed":0}`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(bot): alert-dispatcher edge function — claim, send, record (MRP-26)"
```

---

### Task 9: Verification harness, docs, PR (MRP-28)

**Files:**
- Create: `docs/verification/phase-3-bot.md`
- Modify: Linear (comment), GitHub (PR)

- [ ] **Step 1: Write the verification checklist**

`docs/verification/phase-3-bot.md` — the MRP-28 exit checklist with exact steps and the measurement queries:

```markdown
# Phase 3 verification — Telegram bot & alerts (MRP-28)

## Deploy prerequisites (prod)
- [ ] `yarn deploy:functions` (deploys telegram-bot + alert-dispatcher)
- [ ] `npx supabase secrets set CRON_SECRET=…` and `yarn cron:set-secret <prod-url> <same-secret>`
- [ ] BotFather `/setcommands`: start, menu, register, current, alert

## Flow 2 — onboarding (fresh Telegram account)
- [ ] /start explains registration
- [ ] /register <device-id> links and confirms
- [ ] /current returns live readings from the device
- [ ] /menu buttons: Current / Alerts / Register Device / About all navigate; Back works

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

    select s.id, s.time, s.timezone, d.fire_date, d.status,
           d.created_at,
           d.created_at - ((d.fire_date + s.time) at time zone s.timezone) as lag
    from alert_deliveries d
    join schedules s on s.id = d.schedule_id
    order by d.created_at desc;

- [ ] every row: status = sent, lag between 0 and 60 s
- [ ] alert content lists all six T6 parameters (missing sensors → unavailable)

## Isolation
- [ ] second Telegram account: /register of the claimed device → "already linked"
- [ ] second account /current does not show the first account's device

## Findings
(record results; file new tickets for bugs)
```

- [ ] **Step 2: Run the full verification suite**

```bash
# repo root
yarn lint && yarn check-types && yarn test:unit && yarn build
# infra/supabase-db
yarn test:db
# functions dir
deno test --allow-env tests/ && deno check telegram-bot/index.ts alert-dispatcher/index.ts && deno lint
```

Expected: all green. Then run the local parts of the checklist (Flow 2, Flow 5, dispatcher tick) against the local stack and record results in the doc.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add -A
git commit -m "docs: Phase 3 bot verification checklist (MRP-28)"
git push -u origin mrp-18-telegram-bot-alerts
```

PR: base `dev`, title `feat(bot): Telegram bot & alerts — Phase 3 MVP`. Body must contain, verbatim, each on its own line so Linear links them:

```
Closes MRP-18
Closes MRP-20
Closes MRP-21
Closes MRP-23
Closes MRP-24
Closes MRP-26
Refs MRP-28
```

plus a summary (two functions, sessions table, claim RPC + cron, what was verified locally) and the note that MRP-28's multi-day timeliness measurement runs post-deploy. End the body with the standard generated-with footer.

- [ ] **Step 4: Update Linear**

Comment on MRP-18: the bot lives in `infra/supabase-db/supabase/functions/` (repo convention), not `apps/bot`. Comment on MRP-28 linking `docs/verification/phase-3-bot.md` and noting which items remain post-deploy (timeliness over several days; prod `/current` p95).

---

## Self-review notes

- Spec coverage: T1/T2 → Task 3; T3 → Task 4; T4 → Task 5; T5 → Task 6; T6/T7 → Tasks 7–8; MRP-28 → Task 9; MRP-18 → Task 1. Timezone decision (infer + override) → Tasks 5/6 (`inferTimezone`, `saveSlot`). Multi-device decision → Task 5 (`fetchDeviceReadings` returns all memberships). Midnight-wrap and idempotency ACs → Task 7 pgTAP.
- Deliberately deferred (documented in spec): DST spring-forward no-fire; `editMessageText` polish; BotFather `/setcommands` (listed in the Task 9 checklist as a manual deploy step).
