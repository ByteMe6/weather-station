# Public Station API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** the user approves every commit. Each task ends with a commit step — stop and ask before running it.

**Goal:** Users create personal API keys in Settings and use them from their own scripts to list their stations, read latest/raw/aggregated readings, and (owner/editor, read-write key) edit station details — via `/api/v1/stations…`.

**Architecture:** Our own hashed API keys sit behind an `ApiKeyProvider` interface with a single switch point (`getApiKeyProvider()`), so Clerk API keys can replace them later (spec §11). Every station route is wrapped in `withApiKey` (bearer parse → provider authenticate → Postgres rate limit → scope check) and then gated by `requireStation` (membership + shared role predicate) on the service-role client, reusing the existing readings services and the `update_device_profile()` RPC.

**Tech Stack:** Next.js 16 route handlers, Supabase Postgres (migration + pgTAP), supabase-js service-role client, zod 3.25, `@asteasolutions/zod-to-openapi` 7, TanStack Query 5, Clerk (`auth()` in server actions only), Jest (unit + integration).

**Spec:** `docs/superpowers/specs/2026-10-01-public-read-api-design.md`

---

## File map

| File | Responsibility |
| --- | --- |
| `packages/shared/src/constants/public-api.ts` (new) | Scopes, `scopeAllows`, expiry choices, key cap, rate limit, page/span caps, aggregate intervals |
| `packages/shared/src/types/index.ts` (modify) | `ApiStation`, `ApiStationLocation`, `ApiReading`, `ApiErrorBody` DTOs |
| `infra/supabase-db/supabase/migrations/<ts>_public_api_keys.sql` (new) | `api_keys`, `api_rate_limits`, `api_key_authenticate()`, `api_rate_limit_hit()` |
| `infra/supabase-db/supabase/tests/api_keys.sql` (new) | pgTAP for grants, RLS, auth function, limiter |
| `apps/web/src/services/api-keys/api-keys.service.ts` (new) | DB access for our keys |
| `apps/web/src/services/api-keys/rate-limit.service.ts` (new) | Provider-independent limiter calls |
| `apps/web/src/services/devices/devices.service.ts` (modify) | `fetchStationsForUser`, `fetchStationForUser`, `writeDeviceProfile` |
| `apps/web/src/lib/api/keys/provider.ts` (new) | `ApiKeyProvider` interface + DTO types (types only) |
| `apps/web/src/lib/api/keys/own-key-format.ts` (new) | Pure key generation / format / hash helpers |
| `apps/web/src/lib/api/keys/own-provider.ts` (new) | Our `ApiKeyProvider` implementation |
| `apps/web/src/lib/api/keys/index.ts` (new) | `getApiKeyProvider()` — the single switch point |
| `apps/web/src/lib/api/bearer.ts` (new) | `parseBearer(header)` |
| `apps/web/src/lib/api/respond.ts` (new) | JSON/error responses, CORS, rate-limit headers, `preflight` |
| `apps/web/src/lib/api/with-api-key.ts` (new) | The wrapper every station route must use |
| `apps/web/src/lib/api/station-gate.ts` (new) | `requireStation(ctx, id, allows?, forbidden?)` |
| `apps/web/src/lib/api/stations.ts` (new) | DTO mappers + `listStations`, `lastReadingAt` |
| `apps/web/src/lib/api/schemas.ts` (new) | zod query/body schemas, `resolveWindow`, `fieldErrorsFrom` |
| `apps/web/src/lib/api/cursor.ts` (new) | Opaque keyset cursor encode/decode |
| `apps/web/src/app/api/v1/stations/**/route.ts` (new, 5 files) | Route handlers |
| `apps/web/src/lib/openapi/station-schemas.ts` (new) | Response schemas for the docs, typed against the shared DTOs |
| `apps/web/src/lib/openapi/document.ts`, `versions.ts`, `docs-enabled.ts` (modify) | Register operations, `1.1.0`, docs on in prod |
| `apps/web/src/actions/api-keys.action.ts` (new) | create / list / revoke server actions |
| `apps/web/src/services/api-keys/api-keys.queries.ts` (new) | TanStack hooks |
| `apps/web/src/components/settings/ApiKeysCard.tsx` (new) + `settings/page.tsx` (modify) | Settings UI |
| `docs/04-prd.md`, `docs/privacy-data-minimisation.md`, `CLAUDE.md` (modify) | Documentation |

The first line of each code block (`// apps/web/...`) names the file it belongs in — do **not** copy that comment into the file.

Commands below run from the repo root unless a `cd` is shown. Local Supabase must be running for Tasks 2, 3, 5 and 16 (`cd infra/supabase-db && npx supabase start`).

---

### Task 0: Record the spec deviations decided while planning

Four details changed between the spec and this plan; write them into the spec so the two do not disagree.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-public-read-api-design.md`

- [ ] **Step 1: Edit §3.1** — replace the `key_hash` row with:

```markdown
| `key_hash` | `text not null unique check (key_hash ~ '^[0-9a-f]{64}$')` | lowercase hex SHA-256 of the full key; the key itself is never stored. Text rather than bytea so supabase-js passes it without bytea escaping |
```

and in §3.3 change the signature to `public.api_key_authenticate(p_key_hash text)` and the returned columns to `out_key_id, out_user_id, out_scope` (out_-prefixed like `update_device_profile`, so they cannot shadow `api_keys` columns inside plpgsql). In §3.4 the returned columns become `out_allowed, out_remaining, out_reset_at`.

- [ ] **Step 2: Edit §5** — in the `packages/shared` row remove `API_KEY_PREFIX = 'wsk_live_'` (the prefix is a detail of our provider and lives in `lib/api/keys/own-key-format.ts`); replace the `lib/api/station-gate.ts` row's text with: "`requireStation(ctx, stationId, allows?, forbidden?)` → the station row (role + device) or a 404/403 response, in **one** query (`fetchStationForUser`); malformed ids are 404. Uses the shared predicates — no local re-spelling."

- [ ] **Step 3: Edit the Proxy paragraph in §5 and the matching bullet in §8** — the unit proxy test mocks `clerkMiddleware`, so it cannot prove what real Clerk does with a foreign bearer token. Replace "A test pins that …" with: "Verified end-to-end in the manual check (Task 16): a `Bearer wsk_live_…` request to a station route reaches `withApiKey` and gets our JSON 401/200, not a Clerk redirect. A unit test pins that `/api/v1/stations/**` is in `PUBLIC_ROUTES`."

- [ ] **Step 4: Commit** (ask first)

```bash
git add docs/superpowers/specs/2026-10-01-public-read-api-design.md
git commit -m "docs(api): align spec with plan decisions (text hash, requireStation, proxy check)"
```

---

### Task 1: Shared constants and DTO types

**Files:**
- Create: `packages/shared/src/constants/public-api.ts`
- Modify: `packages/shared/src/constants/index.ts` (append export)
- Modify: `packages/shared/src/types/index.ts` (append DTOs)
- Test: `packages/shared/tests/unit/public-api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/unit/public-api.test.ts
import {
  API_AGGREGATE_INTERVAL_MINUTES,
  API_AGGREGATE_INTERVALS,
  API_AGGREGATE_MAX_SPAN_MS,
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_EXPIRY_DAYS,
  API_READINGS_PAGE_DEFAULT,
  API_READINGS_PAGE_MAX,
  aggregateMaxSpanMs,
  scopeAllows,
} from '../../src/constants/public-api'

describe('public API constants', () => {
  it.each([
    ['read', 'read', true],
    ['read_write', 'read', true],
    ['read_write', 'read_write', true],
    ['read', 'read_write', false],
  ] as const)('a %s key on a %s route → %s', (granted, required, allowed) => {
    expect(scopeAllows(granted, required)).toBe(allowed)
  })

  // readings_bucketed() refuses p_bucket_minutes outside 1..1440 by returning
  // nothing, which would look like "no data" rather than an error.
  it('keeps every aggregate interval inside readings_bucketed bounds', () => {
    for (const interval of API_AGGREGATE_INTERVALS) {
      const minutes = API_AGGREGATE_INTERVAL_MINUTES[interval]
      expect(minutes).toBeGreaterThanOrEqual(1)
      expect(minutes).toBeLessThanOrEqual(1440)
    }
  })

  it('caps an aggregate span at 1000 buckets and at most 366 days', () => {
    expect(aggregateMaxSpanMs('15m')).toBe(1000 * 15 * 60_000)
    expect(aggregateMaxSpanMs('1h')).toBe(1000 * 60 * 60_000)
    expect(aggregateMaxSpanMs('1d')).toBe(API_AGGREGATE_MAX_SPAN_MS)
    expect(API_AGGREGATE_MAX_SPAN_MS).toBe(366 * 86_400_000)
  })

  // PostgREST's max_rows is 1000; a larger page is silently truncated.
  it('keeps the raw page size within PostgREST max_rows', () => {
    expect(API_READINGS_PAGE_MAX).toBeLessThanOrEqual(1000)
    expect(API_READINGS_PAGE_DEFAULT).toBeLessThanOrEqual(API_READINGS_PAGE_MAX)
  })

  it('offers the default expiry among the choices', () => {
    expect(API_KEY_EXPIRY_DAYS).toContain(API_KEY_DEFAULT_EXPIRY_DAYS)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/shared test:unit -t "public API constants"`
Expected: FAIL — `Cannot find module '../../src/constants/public-api'`

- [ ] **Step 3: Create the constants module**

```ts
// packages/shared/src/constants/public-api.ts
/**
 * Contract constants for the key-authenticated station API (/api/v1/stations,
 * docs/superpowers/specs/2026-10-01-public-read-api-design.md). Shared so the
 * route handlers, the server actions and the Settings UI cannot disagree.
 */

/** `read` keys may call every GET; PATCH needs `read_write`. Mirrors the api_keys.scope check constraint. */
export const API_KEY_SCOPES = ['read', 'read_write'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** A `read_write` key satisfies `read`; only `read_write` satisfies `read_write`. */
export const scopeAllows = (
  granted: ApiKeyScope,
  required: ApiKeyScope,
): boolean => required === 'read' || granted === 'read_write'

/** Expiry choices offered at creation; `null` (never) is offered alongside. */
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const

export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number]

export const API_KEY_DEFAULT_EXPIRY_DAYS: ApiKeyExpiryDays = 90

/** Active (not revoked, not expired) keys per user. */
export const API_KEY_MAX_ACTIVE = 10

export const API_KEY_NAME_MAX_LENGTH = 60

/** Fixed-window limit per key, enforced by api_rate_limit_hit(). */
export const API_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const

export const API_READINGS_PAGE_DEFAULT = 288
/** PostgREST max_rows — a larger page would be truncated without an error. */
export const API_READINGS_PAGE_MAX = 1000
export const API_READINGS_DEFAULT_SPAN_MS = 24 * 3_600_000
export const API_READINGS_MAX_SPAN_MS = 31 * 86_400_000

export const API_AGGREGATE_INTERVALS = ['15m', '1h', '6h', '1d'] as const

export type ApiAggregateInterval = (typeof API_AGGREGATE_INTERVALS)[number]

/** Bucket width in minutes; readings_bucketed() accepts 1..1440. */
export const API_AGGREGATE_INTERVAL_MINUTES: Record<
  ApiAggregateInterval,
  number
> = { '15m': 15, '1h': 60, '6h': 360, '1d': 1440 }

export const API_AGGREGATE_DEFAULT_INTERVAL: ApiAggregateInterval = '1h'
export const API_AGGREGATE_DEFAULT_SPAN_MS = 7 * 86_400_000
export const API_AGGREGATE_MAX_BUCKETS = 1000
export const API_AGGREGATE_MAX_SPAN_MS = 366 * 86_400_000

/** Longest window an aggregate request may span at `interval`. */
export const aggregateMaxSpanMs = (interval: ApiAggregateInterval): number =>
  Math.min(
    API_AGGREGATE_MAX_SPAN_MS,
    API_AGGREGATE_MAX_BUCKETS * API_AGGREGATE_INTERVAL_MINUTES[interval] * 60_000,
  )
```

- [ ] **Step 4: Export it** — append to `packages/shared/src/constants/index.ts`:

```ts
export * from './public-api.ts'
```

- [ ] **Step 5: Add the DTO types** — append to `packages/shared/src/types/index.ts`:

```ts
/** Public station API (/api/v1/stations) — response shapes scripts receive. */
export interface ApiStationLocation {
  latitude: number
  longitude: number
}

export interface ApiStation {
  /** The device id, e.g. `ws-abc123def456`. */
  id: string
  /** `label ?? id` — what the UI shows. */
  name: string
  label: string | null
  address: string | null
  location: ApiStationLocation | null
  /** The key owner's role on this station. */
  role: DeviceRole
  status: DeviceStatus
  addedAt: string
  createdAt: string
  lastReadingAt: string | null
}

export interface ApiReading extends SensorValues {
  timestamp: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string>
  }
}
```

- [ ] **Step 6: Run the tests and type check**

Run: `yarn workspace @ws/shared test:unit && yarn workspace @ws/shared check-types`
Expected: PASS, no type errors

- [ ] **Step 7: Commit** (ask first)

```bash
git add packages/shared
git commit -m "feat(shared): public station API constants and DTO types"
```

---

### Task 2: Migration — keys, limiter, functions + pgTAP

Use the `/new-migration` skill's conventions. Supabase's default ACL auto-grants TRUNCATE/REFERENCES/TRIGGER to client roles on new tables and EXECUTE to `public` on new functions — revoke both explicitly (see `20260823144410_bot_sessions.sql`).

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_public_api_keys.sql`
- Create: `infra/supabase-db/supabase/tests/api_keys.sql`
- Modify (generated): `infra/supabase-db/src/types/database.ts`

- [ ] **Step 1: Write the failing pgTAP test**

```sql
-- infra/supabase-db/supabase/tests/api_keys.sql
-- Public station API keys + rate limiter (spec 2026-10-01). Service-role only:
-- clients hold no privilege on the tables or the functions.
begin;
select plan(30);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_api_a'),
  ('00000000-0000-0000-0000-0000000000b1', 'user_api_b');
insert into public.api_keys (id, user_id, name, key_hash, key_hint, scope, expires_at, revoked_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'live',
   encode(sha256('key-live'::bytea), 'hex'), 'live', 'read', null, null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1', 'revoked',
   encode(sha256('key-revoked'::bytea), 'hex'), 'revk', 'read_write', null, now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'expired',
   encode(sha256('key-expired'::bytea), 'hex'), 'expd', 'read', now() - interval '1 second', null),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b1', 'future',
   encode(sha256('key-b'::bytea), 'hex'), 'kb00', 'read_write', now() + interval '1 day', null);

-- Grants and RLS -------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.api_keys'::regclass), 'api_keys: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.api_rate_limits'::regclass), 'api_rate_limits: RLS enabled');
-- Negative over the full privilege list: catches the default-ACL auto-grant of
-- RLS-exempt TRUNCATE/REFERENCES/TRIGGER to client roles.
select ok(not (
     has_table_privilege('anon', 'public.api_keys', 'select, insert, update, delete, truncate, references, trigger')
  or has_table_privilege('authenticated', 'public.api_keys', 'select, insert, update, delete, truncate, references, trigger')
), 'api_keys: anon/authenticated hold no privilege of any kind');
select ok(not (
     has_table_privilege('anon', 'public.api_rate_limits', 'select, insert, update, delete, truncate, references, trigger')
  or has_table_privilege('authenticated', 'public.api_rate_limits', 'select, insert, update, delete, truncate, references, trigger')
), 'api_rate_limits: anon/authenticated hold no privilege of any kind');
-- bool_and per privilege: has_table_privilege('a, b') is true when ANY is held.
select ok((select bool_and(has_table_privilege('service_role', t, p))
           from unnest(array['public.api_keys', 'public.api_rate_limits']) as t,
                unnest(array['select', 'insert', 'update', 'delete']) as p),
          'service_role has CRUD on both tables');
select ok(not (
     has_function_privilege('anon', 'public.api_key_authenticate(text)', 'execute')
  or has_function_privilege('authenticated', 'public.api_key_authenticate(text)', 'execute')
), 'clients cannot execute api_key_authenticate');
select ok(not (
     has_function_privilege('anon', 'public.api_rate_limit_hit(text, integer, integer)', 'execute')
  or has_function_privilege('authenticated', 'public.api_rate_limit_hit(text, integer, integer)', 'execute')
), 'clients cannot execute api_rate_limit_hit');
select ok(
  has_function_privilege('service_role', 'public.api_key_authenticate(text)', 'execute')
  and has_function_privilege('service_role', 'public.api_rate_limit_hit(text, integer, integer)', 'execute'),
  'service_role executes both functions'
);

-- api_key_authenticate -------------------------------------------------------
select results_eq(
  $$ select out_key_id, out_user_id, out_scope
       from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  $$ values ('10000000-0000-0000-0000-000000000001'::uuid,
             '00000000-0000-0000-0000-0000000000a1'::uuid, 'read'::text) $$,
  'a live key authenticates to its owner and scope'
);
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('key-revoked'::bytea), 'hex')) $$,
  'a revoked key does not authenticate');
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('key-expired'::bytea), 'hex')) $$,
  'an expired key does not authenticate');
select is_empty($$ select * from public.api_key_authenticate(encode(sha256('never-issued'::bytea), 'hex')) $$,
  'an unknown key does not authenticate');
select results_eq(
  $$ select out_key_id, out_user_id, out_scope
       from public.api_key_authenticate(encode(sha256('key-b'::bytea), 'hex')) $$,
  $$ values ('10000000-0000-0000-0000-000000000004'::uuid,
             '00000000-0000-0000-0000-0000000000b1'::uuid, 'read_write'::text) $$,
  'a key that expires in the future authenticates, as its own owner'
);
select isnt((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  null, 'authenticating stamps last_used_at');

-- now() is fixed for the transaction, so exact timestamps are comparable.
update public.api_keys set last_used_at = now() - interval '30 seconds'
 where id = '10000000-0000-0000-0000-000000000001';
select isnt_empty($$ select * from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  'the live key authenticates again');
select is((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  now() - interval '30 seconds', 'last_used_at is not rewritten within a minute');
update public.api_keys set last_used_at = now() - interval '2 minutes'
 where id = '10000000-0000-0000-0000-000000000001';
select isnt_empty($$ select * from public.api_key_authenticate(encode(sha256('key-live'::bytea), 'hex')) $$,
  'and once more after two minutes');
select is((select last_used_at from public.api_keys where id = '10000000-0000-0000-0000-000000000001'),
  now(), 'last_used_at is refreshed after a minute');

-- api_rate_limit_hit ---------------------------------------------------------
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 2) $$, 'first hit is allowed, two left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 1) $$, 'second hit is allowed, one left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 0) $$, 'third hit is allowed, none left');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (false, 0) $$, 'the hit over the limit is refused');
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:u', 3, 60) $$,
  $$ values (true, 2) $$, 'buckets are independent');
update public.api_rate_limits set window_start = window_start - interval '60 seconds' where bucket = 'key:t';
select results_eq($$ select out_allowed, out_remaining from public.api_rate_limit_hit('key:t', 3, 60) $$,
  $$ values (true, 2) $$, 'a new window starts the count over');
select is(
  (select out_reset_at from public.api_rate_limit_hit('key:v', 3, 60)),
  to_timestamp(floor(extract(epoch from now()) / 60) * 60) + interval '60 seconds',
  'reset_at is the end of the current window'
);
select throws_ok($$ select * from public.api_rate_limit_hit('key:t', 0, 60) $$,
  '22023', 'API_RATE_LIMIT_INVALID', 'a non-positive limit is rejected');

-- Constraints ----------------------------------------------------------------
select throws_ok(
  $$ insert into public.api_keys (user_id, name, key_hash, key_hint, scope)
     values ('00000000-0000-0000-0000-0000000000a1', 'bad', 'not-a-hash', 'abcd', 'read') $$,
  '23514', null, 'key_hash must be 64 lowercase hex characters');
select throws_ok(
  $$ insert into public.api_keys (user_id, name, key_hash, key_hint, scope)
     values ('00000000-0000-0000-0000-0000000000a1', 'bad', repeat('a', 64), 'abcd', 'admin') $$,
  '23514', null, 'scope is read or read_write only');

-- Client role, for real -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_api_a","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.api_keys $$, '42501', null,
  'an authenticated client cannot read api_keys, not even its own rows');
reset role;

-- Cascade --------------------------------------------------------------------
delete from public.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.api_keys where user_id = '00000000-0000-0000-0000-0000000000a1'),
  0, 'deleting a user deletes their keys');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd infra/supabase-db && yarn test:db`
Expected: FAIL in `api_keys.sql` — `relation "public.api_keys" does not exist`

- [ ] **Step 3: Create the migration file**

Run: `cd infra/supabase-db && yarn migrate:new public_api_keys`
Expected: prints the new path `supabase/migrations/<UTC timestamp>_public_api_keys.sql`.

Write this into that file:

```sql
-- Public station API (docs/superpowers/specs/2026-10-01-public-read-api-design.md):
-- personal API keys for users' own scripts, and a provider-independent rate
-- limiter. Both are service-role only — the same posture as devices.secret
-- and bot_sessions: RLS on, no policies, no client grants.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- Lowercase hex SHA-256 of the full key; the key itself is never stored.
  -- A fast deterministic hash is correct here (not bcrypt/argon2): keys carry
  -- 256 random bits, so brute force is infeasible, and lookup stays one
  -- indexed equality. Text, not bytea, so supabase-js passes it unescaped.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  -- Last 4 characters, so Settings can tell keys apart without the secret.
  key_hint text not null check (char_length(key_hint) = 4),
  -- Mirrors API_KEY_SCOPES in @ws/shared.
  scope text not null check (scope in ('read', 'read_write')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  -- Soft delete, so the Settings list can still show a revoked key.
  revoked_at timestamptz
);

create index api_keys_user_id_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select, insert, update, delete on public.api_keys to service_role;

-- One row per bucket; the window resets in place, so nothing needs sweeping.
-- `bucket` is an opaque string ('key:<id>'), deliberately NOT a foreign key to
-- api_keys: the limiter must keep working unchanged if keys move to Clerk
-- (spec §11), whose ids are 'ak_…' strings that never appear in this database.
create table public.api_rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  count int not null
);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

-- Resolve a key hash to its owner and scope; stamp last_used_at at most once
-- a minute so a polling script does not rewrite the row on every request.
-- Returns no row for unknown, revoked and expired keys — the caller answers
-- the same 401 for all three. out_-prefixed so the OUT names cannot shadow the
-- api_keys columns this function reads (see update_device_profile).
create or replace function public.api_key_authenticate(p_key_hash text)
returns table (out_key_id uuid, out_user_id uuid, out_scope text)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_user_id uuid;
  v_scope text;
  v_last_used_at timestamptz;
begin
  select k.id, k.user_id, k.scope, k.last_used_at
    into v_id, v_user_id, v_scope, v_last_used_at
    from public.api_keys k
   where k.key_hash = p_key_hash
     and k.revoked_at is null
     and (k.expires_at is null or k.expires_at > now());

  if v_id is null then
    return;
  end if;

  if v_last_used_at is null or v_last_used_at < now() - interval '1 minute' then
    update public.api_keys k set last_used_at = now() where k.id = v_id;
  end if;

  out_key_id := v_id;
  out_user_id := v_user_id;
  out_scope := v_scope;
  return next;
end;
$$;

revoke execute on function public.api_key_authenticate(text) from public, anon, authenticated;
grant execute on function public.api_key_authenticate(text) to service_role;

-- Fixed-window counter. Limit and window are arguments so the numbers live in
-- @ws/shared (API_RATE_LIMIT), not here. One atomic upsert: concurrent hits on
-- the same bucket serialise on the row. A refused hit still counts.
create or replace function public.api_rate_limit_hit(
  p_bucket text,
  p_limit int,
  p_window_seconds int
)
returns table (out_allowed boolean, out_remaining int, out_reset_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'API_RATE_LIMIT_INVALID' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.api_rate_limits as r (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket) do update
    set window_start = excluded.window_start,
        count = case when r.window_start < excluded.window_start then 1 else r.count + 1 end
  returning r.count into v_count;

  out_allowed := v_count <= p_limit;
  out_remaining := greatest(p_limit - v_count, 0);
  out_reset_at := v_window + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

revoke execute on function public.api_rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.api_rate_limit_hit(text, int, int) to service_role;
```

- [ ] **Step 4: Apply and run the DB tests**

Run: `cd infra/supabase-db && yarn db-reset:local && yarn test:db`
Expected: all files PASS, including `api_keys.sql ... ok` (30 tests).

- [ ] **Step 5: Regenerate types**

Run: `cd infra/supabase-db && yarn regenerate:types && grep -n "api_key_authenticate\|api_rate_limit_hit\|api_keys:" src/types/database.ts`
Expected: entries for both functions (Args `p_key_hash: string`; `p_bucket`, `p_limit`, `p_window_seconds`) and the `api_keys` table.

- [ ] **Step 6: Review** — dispatch the `rls-reviewer` agent on the new migration; fix anything it finds before committing.

- [ ] **Step 7: Commit** (ask first)

```bash
git add infra/supabase-db/supabase/migrations/*_public_api_keys.sql infra/supabase-db/supabase/tests/api_keys.sql infra/supabase-db/src/types/database.ts
git commit -m "feat(db): api_keys, api_rate_limits and their service-role functions"
```

---

### Task 3: Provider interface, key services and limiter service

**Files:**
- Create: `apps/web/src/lib/api/keys/provider.ts`
- Create: `apps/web/src/services/api-keys/api-keys.service.ts`
- Create: `apps/web/src/services/api-keys/rate-limit.service.ts`
- Test: `apps/web/tests/integration/services/api-keys/api-keys.service.integration.test.ts`

- [ ] **Step 1: Create the provider interface (types only — imported by client code too)**

```ts
// apps/web/src/lib/api/keys/provider.ts
import type { ApiKeyScope } from '@ws/shared'

/**
 * The seam between "where API keys live" and everything else (spec §5.1).
 * Routes, withApiKey, the limiter, the actions and the Settings UI depend on
 * this and never on an implementation; getApiKeyProvider() picks one.
 */

export interface ApiKeyPrincipal {
  /** Opaque: our uuid today, a Clerk `ak_…` id after a swap. */
  keyId: string
  /** Internal users.id — an implementation keyed by Clerk id maps it. */
  userId: string
  scope: ApiKeyScope
}

export interface ApiKeySummary {
  id: string
  name: string
  scope: ApiKeyScope
  /** Display tail of the secret, e.g. "a9Xk". */
  hint: string
  createdAt: string
  /** null when never used — or when the provider cannot report it. */
  lastUsedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
}

/** Both ids, so either implementation has what it keys on. */
export interface ApiKeyOwner {
  userId: string
  clerkUserId: string
}

export interface ApiKeyCreateInput {
  name: string
  scope: ApiKeyScope
  /** null = never expires. */
  expiresInDays: number | null
}

export interface ApiKeyProvider {
  /**
   * Principal for a token, or null for every "not a valid key" case (unknown,
   * malformed, revoked, expired). Throws only on infrastructure failure, so an
   * outage is a 500 and never a misleading 401.
   */
  authenticate: (token: string) => Promise<ApiKeyPrincipal | null>
  /** The secret is returned exactly once, here. */
  create: (
    owner: ApiKeyOwner,
    input: ApiKeyCreateInput,
  ) => Promise<{ key: ApiKeySummary; secret: string }>
  /** Newest first, revoked and expired included. */
  list: (owner: ApiKeyOwner) => Promise<ApiKeySummary[]>
  countActive: (owner: ApiKeyOwner) => Promise<number>
  /** false when the key does not exist, is already revoked, or is not the owner's. */
  revoke: (owner: ApiKeyOwner, keyId: string) => Promise<boolean>
}
```

- [ ] **Step 2: Write the failing integration test**

```ts
// apps/web/tests/integration/services/api-keys/api-keys.service.integration.test.ts
import { createHash } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import {
  authenticateApiKeyHash,
  countActiveApiKeys,
  fetchApiKeysForUser,
  insertApiKey,
  revokeApiKey,
} from '@/services/api-keys/api-keys.service'
import {
  deleteRateLimitBucket,
  hitRateLimit,
} from '@/services/api-keys/rate-limit.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_apikeys_a'
const CLERK_B = 'user_inttest_apikeys_b'
const BUCKET = 'key:inttest-bucket'
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
  await db.from('api_rate_limits').delete().eq('bucket', BUCKET)
})

describe('api-keys service (integration)', () => {
  it('inserts, lists, authenticates and revokes a key', async () => {
    const userId = await makeUser(CLERK_A)
    const created = await insertApiKey(db, {
      userId,
      name: 'Grafana',
      scope: 'read',
      keyHash: hash('secret-1'),
      keyHint: 'et-1',
      expiresAt: null,
    })
    expect(created).toMatchObject({
      name: 'Grafana',
      scope: 'read',
      hint: 'et-1',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    })

    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('secret-1') }),
    ).resolves.toEqual({ keyId: created.id, userId, scope: 'read' })
    const [listed] = await fetchApiKeysForUser(db, { userId })
    expect(listed?.lastUsedAt).not.toBeNull()

    await expect(
      revokeApiKey(db, { userId, keyId: created.id }),
    ).resolves.toBe(true)
    await expect(
      revokeApiKey(db, { userId, keyId: created.id }),
    ).resolves.toBe(false)
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('secret-1') }),
    ).resolves.toBeNull()
  })

  it('counts only active keys and never another user’s', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await insertApiKey(db, {
      userId: a,
      name: 'live',
      scope: 'read',
      keyHash: hash('a-live'),
      keyHint: 'live',
      expiresAt: null,
    })
    await insertApiKey(db, {
      userId: a,
      name: 'expired',
      scope: 'read',
      keyHash: hash('a-expired'),
      keyHint: 'expd',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await insertApiKey(db, {
      userId: b,
      name: 'b',
      scope: 'read_write',
      keyHash: hash('b-live'),
      keyHint: 'blve',
      expiresAt: null,
    })

    await expect(countActiveApiKeys(db, { userId: a })).resolves.toBe(1)
    expect(await fetchApiKeysForUser(db, { userId: a })).toHaveLength(2)
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('a-expired') }),
    ).resolves.toBeNull()
  })

  it('refuses to revoke another user’s key', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    const created = await insertApiKey(db, {
      userId: a,
      name: 'mine',
      scope: 'read',
      keyHash: hash('a-mine'),
      keyHint: 'mine',
      expiresAt: null,
    })
    await expect(
      revokeApiKey(db, { userId: b, keyId: created.id }),
    ).resolves.toBe(false)
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('a-mine') }),
    ).resolves.not.toBeNull()
  })

  it('rate-limits per bucket and resets when the bucket is deleted', async () => {
    const hit = () =>
      hitRateLimit(db, { bucket: BUCKET, limit: 2, windowSeconds: 60 })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 1 })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 0 })
    const refused = await hit()
    expect(refused).toMatchObject({ allowed: false, remaining: 0 })
    expect(Date.parse(refused.resetAt)).toBeGreaterThan(Date.now())

    await deleteRateLimitBucket(db, { bucket: BUCKET })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 1 })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `yarn workspace @ws/web test:integration:secrets -- api-keys.service` (or `yarn workspace @ws/web test:integration -- api-keys.service` with a local `.env`)
Expected: FAIL — `Cannot find module '@/services/api-keys/api-keys.service'`

- [ ] **Step 4: Implement the key service**

```ts
// apps/web/src/services/api-keys/api-keys.service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

import type { ApiKeyPrincipal, ApiKeySummary } from '@/lib/api/keys/provider'

/**
 * Aliased summary columns. key_hash is deliberately absent: it never leaves the
 * database except as the argument of api_key_authenticate().
 */
const SUMMARY_COLUMNS =
  'id, name, scope, hint:key_hint, createdAt:created_at, lastUsedAt:last_used_at, expiresAt:expires_at, revokedAt:revoked_at'

export const insertApiKey = async (
  supabase: SupabaseClient<Database>,
  params: {
    userId: string
    name: string
    scope: ApiKeyScope
    keyHash: string
    keyHint: string
    expiresAt: string | null
  },
): Promise<ApiKeySummary> => {
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      user_id: params.userId,
      name: params.name,
      scope: params.scope,
      key_hash: params.keyHash,
      key_hint: params.keyHint,
      expires_at: params.expiresAt,
    })
    .select(SUMMARY_COLUMNS)
    .single()

  if (error) {
    throw new ServiceError(
      `Failed to create API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The api_keys.scope check constraint guarantees scope ∈ ApiKeyScope.
  return data as ApiKeySummary
}

/** A user's keys, newest first, revoked and expired included. */
export const fetchApiKeysForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<ApiKeySummary[]> => {
  const { data, error } = await supabase
    .from('api_keys')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', params.userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch API keys: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The api_keys.scope check constraint guarantees scope ∈ ApiKeyScope.
  return (data ?? []) as ApiKeySummary[]
}

/** Keys that still authenticate: not revoked and not expired. */
export const countActiveApiKeys = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<number> => {
  const { count, error } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  if (error) {
    throw new ServiceError(
      `Failed to count API keys: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return count ?? 0
}

/**
 * Soft-revokes one of the user's keys. Chains .select() because PostgREST
 * reports no error for an update that matched nothing (CLAUDE.md): false means
 * not found, already revoked, or someone else's.
 */
export const revokeApiKey = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string; keyId: string },
): Promise<boolean> => {
  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.keyId)
    .eq('user_id', params.userId)
    .is('revoked_at', null)
    .select('id')

  if (error) {
    throw new ServiceError(
      `Failed to revoke API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).length > 0
}

/** Principal for a key hash, or null for unknown / revoked / expired. */
export const authenticateApiKeyHash = async (
  supabase: SupabaseClient<Database>,
  params: { keyHash: string },
): Promise<ApiKeyPrincipal | null> => {
  const { data, error } = await supabase.rpc('api_key_authenticate', {
    p_key_hash: params.keyHash,
  })
  if (error) {
    throw new ServiceError(
      `Failed to authenticate API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  const row = data?.[0]
  if (!row) return null
  // rpc() rows cannot be aliased (CLAUDE.md); the out_ prefix keeps the OUT
  // names from shadowing api_keys columns inside the plpgsql body. The scope
  // check constraint guarantees out_scope ∈ ApiKeyScope.
  return {
    keyId: row.out_key_id,
    userId: row.out_user_id,
    scope: row.out_scope as ApiKeyScope,
  }
}
```

- [ ] **Step 5: Implement the limiter service**

```ts
// apps/web/src/services/api-keys/rate-limit.service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: string
}

/**
 * The limiter's bucket for one key. A string, not a foreign key, so it works
 * the same for our uuids and for Clerk's `ak_…` ids (spec §11).
 */
export const apiKeyRateLimitBucket = (keyId: string): string => `key:${keyId}`

export const hitRateLimit = async (
  supabase: SupabaseClient<Database>,
  params: { bucket: string; limit: number; windowSeconds: number },
): Promise<RateLimitResult> => {
  const { data, error } = await supabase.rpc('api_rate_limit_hit', {
    p_bucket: params.bucket,
    p_limit: params.limit,
    p_window_seconds: params.windowSeconds,
  })
  if (error) {
    throw new ServiceError(
      `Failed to apply rate limit: ${error.message}`,
      error.code,
      error.details,
    )
  }
  const row = data?.[0]
  if (!row) throw new ServiceError('Rate limiter returned no row')
  // rpc() rows cannot be aliased (CLAUDE.md) — mapped here.
  return {
    allowed: row.out_allowed,
    remaining: row.out_remaining,
    resetAt: row.out_reset_at,
  }
}

/** Drops a bucket's counter (on revoke), so a re-used id never inherits it. */
export const deleteRateLimitBucket = async (
  supabase: SupabaseClient<Database>,
  params: { bucket: string },
): Promise<void> => {
  const { error } = await supabase
    .from('api_rate_limits')
    .delete()
    .eq('bucket', params.bucket)
  if (error) {
    throw new ServiceError(
      `Failed to delete rate-limit bucket: ${error.message}`,
      error.code,
      error.details,
    )
  }
}
```

- [ ] **Step 6: Run the integration test**

Run: `yarn workspace @ws/web test:integration:secrets -- api-keys.service`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit** (ask first)

```bash
git add apps/web/src/lib/api/keys/provider.ts apps/web/src/services/api-keys apps/web/tests/integration/services/api-keys
git commit -m "feat(api): ApiKeyProvider interface, key and rate-limit services"
```

---

### Task 4: Our key provider and the switch point

**Files:**
- Create: `apps/web/src/lib/api/keys/own-key-format.ts`
- Create: `apps/web/src/lib/api/keys/own-provider.ts`
- Create: `apps/web/src/lib/api/keys/index.ts`
- Test: `apps/web/tests/unit/lib/api/keys/own-key-format.test.ts`
- Create: `apps/web/tests/integration/helpers/api-key-provider-contract.ts`
- Test: `apps/web/tests/integration/lib/api/keys/own-provider.integration.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/web/tests/unit/lib/api/keys/own-key-format.test.ts
import {
  OWN_KEY_PREFIX,
  generateOwnKey,
  hashOwnKey,
  isOwnKeyFormat,
  ownKeyHint,
} from '@/lib/api/keys/own-key-format'

describe('own API key format', () => {
  it('generates prefixed keys with 32 random bytes of base64url', () => {
    const key = generateOwnKey()
    expect(key.startsWith(OWN_KEY_PREFIX)).toBe(true)
    expect(key.slice(OWN_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isOwnKeyFormat(key)).toBe(true)
  })

  it('never generates the same key twice in a row', () => {
    expect(generateOwnKey()).not.toBe(generateOwnKey())
  })

  it.each([
    ['empty', ''],
    ['wrong prefix', `ak_live_${'a'.repeat(43)}`],
    ['short body', `${OWN_KEY_PREFIX}${'a'.repeat(42)}`],
    ['long body', `${OWN_KEY_PREFIX}${'a'.repeat(44)}`],
    ['bad character', `${OWN_KEY_PREFIX}${'a'.repeat(42)}=`],
  ])('rejects %s', (_label, token) => {
    expect(isOwnKeyFormat(token)).toBe(false)
  })

  it('hashes to lowercase hex SHA-256, deterministically', () => {
    // sha256("abc")
    expect(hashOwnKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hashOwnKey('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hints with the last four characters', () => {
    expect(ownKeyHint(`${OWN_KEY_PREFIX}${'a'.repeat(39)}WXYZ`)).toBe('WXYZ')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- own-key-format`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the format helpers (pure, no DB)**

```ts
// apps/web/src/lib/api/keys/own-key-format.ts
import { createHash, randomBytes } from 'node:crypto'

/**
 * Our key format: a recognisable prefix (so a leaked key is greppable and
 * secret scanners can flag it) plus 32 random bytes as base64url — 43
 * characters, no padding. Provider-specific on purpose: nothing outside
 * lib/api/keys/own-* may assume it (spec §5.1).
 */
export const OWN_KEY_PREFIX = 'wsk_live_'

const KEY_BODY = /^[A-Za-z0-9_-]{43}$/

export const generateOwnKey = (): string =>
  `${OWN_KEY_PREFIX}${randomBytes(32).toString('base64url')}`

/** Cheap shape check, so garbage never costs a database round trip. */
export const isOwnKeyFormat = (token: string): boolean =>
  token.startsWith(OWN_KEY_PREFIX) &&
  KEY_BODY.test(token.slice(OWN_KEY_PREFIX.length))

/** Lowercase hex SHA-256 — the value stored in api_keys.key_hash. */
export const hashOwnKey = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex')

export const ownKeyHint = (key: string): string => key.slice(-4)
```

- [ ] **Step 4: Run the unit test**

Run: `yarn workspace @ws/web test:unit -- own-key-format`
Expected: PASS

- [ ] **Step 5: Implement the provider and the switch point**

```ts
// apps/web/src/lib/api/keys/own-provider.ts
import 'server-only'

import { createServiceRoleClient } from '@ws/supabase-db'

import {
  generateOwnKey,
  hashOwnKey,
  isOwnKeyFormat,
  ownKeyHint,
} from './own-key-format'
import type { ApiKeyProvider } from './provider'

import {
  authenticateApiKeyHash,
  countActiveApiKeys,
  fetchApiKeysForUser,
  insertApiKey,
  revokeApiKey,
} from '@/services/api-keys/api-keys.service'
import {
  apiKeyRateLimitBucket,
  deleteRateLimitBucket,
} from '@/services/api-keys/rate-limit.service'

const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keys stored hashed in public.api_keys (spec §3.1). */
export const ownApiKeyProvider: ApiKeyProvider = {
  authenticate: async (token) => {
    if (!isOwnKeyFormat(token)) return null
    return authenticateApiKeyHash(createServiceRoleClient(), {
      keyHash: hashOwnKey(token),
    })
  },

  create: async (owner, input) => {
    const secret = generateOwnKey()
    const key = await insertApiKey(createServiceRoleClient(), {
      userId: owner.userId,
      name: input.name,
      scope: input.scope,
      keyHash: hashOwnKey(secret),
      keyHint: ownKeyHint(secret),
      expiresAt:
        input.expiresInDays === null
          ? null
          : new Date(Date.now() + input.expiresInDays * DAY_MS).toISOString(),
    })
    return { key, secret }
  },

  list: async (owner) =>
    fetchApiKeysForUser(createServiceRoleClient(), { userId: owner.userId }),

  countActive: async (owner) =>
    countActiveApiKeys(createServiceRoleClient(), { userId: owner.userId }),

  revoke: async (owner, keyId) => {
    // Our ids are uuids; anything else cannot be ours, and passing it on would
    // turn a "not found" into a Postgres 22P02.
    if (!UUID.test(keyId)) return false
    const service = createServiceRoleClient()
    const revoked = await revokeApiKey(service, {
      userId: owner.userId,
      keyId,
    })
    if (revoked) {
      await deleteRateLimitBucket(service, {
        bucket: apiKeyRateLimitBucket(keyId),
      })
    }
    return revoked
  },
}
```

```ts
// apps/web/src/lib/api/keys/index.ts
import 'server-only'

import { ownApiKeyProvider } from './own-provider'
import type { ApiKeyProvider } from './provider'

/**
 * The single switch point between API-key implementations (spec §5.1, §11).
 * Routes, withApiKey and the actions call this; none of them may import a
 * provider module directly (tests/unit/app/api/v1/stations/registry.test.ts).
 */
export const getApiKeyProvider = (): ApiKeyProvider => ownApiKeyProvider
```

- [ ] **Step 6: Write the provider contract suite and run it against our provider**

```ts
// apps/web/tests/integration/helpers/api-key-provider-contract.ts
import type {
  ApiKeyOwner,
  ApiKeyProvider,
} from '@/lib/api/keys/provider'

export interface ProviderFixture {
  provider: ApiKeyProvider
  ownerA: ApiKeyOwner
  ownerB: ApiKeyOwner
}

/**
 * Behaviour every ApiKeyProvider must have (spec §5.1). Our provider runs it
 * today; a Clerk adapter must pass it unchanged before getApiKeyProvider() is
 * flipped (spec §11).
 */
export const describeApiKeyProvider = (
  name: string,
  setup: () => Promise<ProviderFixture>,
  teardown: () => Promise<void>,
): void => {
  describe(`ApiKeyProvider contract: ${name}`, () => {
    let f: ProviderFixture

    beforeEach(async () => {
      f = await setup()
    })
    afterEach(teardown)

    it('creates a key whose secret authenticates as its owner and scope', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'Grafana',
        scope: 'read',
        expiresInDays: 30,
      })
      expect(key).toMatchObject({
        name: 'Grafana',
        scope: 'read',
        lastUsedAt: null,
        revokedAt: null,
      })
      expect(secret.endsWith(key.hint)).toBe(true)
      const days = (Date.parse(key.expiresAt ?? '') - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29.9)
      expect(days).toBeLessThanOrEqual(30)
      await expect(f.provider.authenticate(secret)).resolves.toEqual({
        keyId: key.id,
        userId: f.ownerA.userId,
        scope: 'read',
      })
    })

    it('creates a key without expiry when asked', async () => {
      const { key } = await f.provider.create(f.ownerA, {
        name: 'Forever',
        scope: 'read_write',
        expiresInDays: null,
      })
      expect(key.expiresAt).toBeNull()
    })

    it('lists only the owner’s keys', async () => {
      await f.provider.create(f.ownerA, {
        name: 'A',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.create(f.ownerB, {
        name: 'B',
        scope: 'read',
        expiresInDays: null,
      })
      const names = (await f.provider.list(f.ownerA)).map((k) => k.name)
      expect(names).toEqual(['A'])
    })

    it('counts only active keys', async () => {
      const first = await f.provider.create(f.ownerA, {
        name: 'one',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.create(f.ownerA, {
        name: 'two',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.revoke(f.ownerA, first.key.id)
      await expect(f.provider.countActive(f.ownerA)).resolves.toBe(1)
      await expect(f.provider.countActive(f.ownerB)).resolves.toBe(0)
    })

    it('refuses to revoke another owner’s key', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'mine',
        scope: 'read',
        expiresInDays: null,
      })
      await expect(f.provider.revoke(f.ownerB, key.id)).resolves.toBe(false)
      await expect(f.provider.authenticate(secret)).resolves.not.toBeNull()
    })

    it('stops authenticating a revoked key, and cannot revoke it twice', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'gone',
        scope: 'read',
        expiresInDays: null,
      })
      await expect(f.provider.revoke(f.ownerA, key.id)).resolves.toBe(true)
      await expect(f.provider.authenticate(secret)).resolves.toBeNull()
      await expect(f.provider.revoke(f.ownerA, key.id)).resolves.toBe(false)
    })

    it('rejects tokens it did not issue', async () => {
      await expect(f.provider.authenticate('garbage')).resolves.toBeNull()
      await expect(
        f.provider.authenticate(`wsk_live_${'A'.repeat(43)}`),
      ).resolves.toBeNull()
    })
  })
}
```

```ts
// apps/web/tests/integration/lib/api/keys/own-provider.integration.test.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { describeApiKeyProvider } from '../../../helpers/api-key-provider-contract'

import { ownApiKeyProvider } from '@/lib/api/keys/own-provider'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_provider_a'
const CLERK_B = 'user_inttest_provider_b'

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

describeApiKeyProvider(
  'own (api_keys table)',
  async () => ({
    provider: ownApiKeyProvider,
    ownerA: { userId: await makeUser(CLERK_A), clerkUserId: CLERK_A },
    ownerB: { userId: await makeUser(CLERK_B), clerkUserId: CLERK_B },
  }),
  async () => {
    // Cascades to api_keys; revoke() already dropped any rate-limit bucket.
    await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
  },
)
```

Run: `yarn workspace @ws/web test:integration:secrets -- own-provider`
Expected: PASS (7 tests)

- [ ] **Step 7: Commit** (ask first)

```bash
git add apps/web/src/lib/api/keys apps/web/tests/unit/lib/api/keys apps/web/tests/integration/helpers/api-key-provider-contract.ts apps/web/tests/integration/lib
git commit -m "feat(api): own API-key provider behind getApiKeyProvider, with contract suite"
```

---

### Task 5: Station services safe for the service-role path

`fetchMyDevices` has no `WHERE` clause and is only correct on an RLS client. These new functions filter by user explicitly.

**Files:**
- Modify: `apps/web/src/services/devices/devices.service.ts`
- Test: `apps/web/tests/integration/services/devices/stations.service.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/web/tests/integration/services/devices/stations.service.integration.test.ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import {
  DEVICE_PROFILE_FORBIDDEN,
  fetchStationForUser,
  fetchStationsForUser,
  writeDeviceProfile,
} from '@/services/devices/devices.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_stations_a'
const CLERK_B = 'user_inttest_stations_b'
const DEV_A = 'ws-inttststa01'
const DEV_B = 'ws-inttststa02'

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

const makeOwnedDevice = async (deviceId: string, owner: string) => {
  await db.from('devices').insert({
    device_id: deviceId,
    secret: 'x'.repeat(64),
    status: 'unregistered',
  })
  const { error } = await db.rpc('claim_device', {
    p_device_id: deviceId,
    p_user_id: owner,
  })
  if (error) throw error
}

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('devices').delete().in('device_id', [DEV_A, DEV_B])
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
})

describe('station services on the service-role client (integration)', () => {
  it('fetchStationsForUser returns only that user’s stations, with their role', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)
    await makeOwnedDevice(DEV_B, b)
    await db
      .from('device_users')
      .insert({ device_id: DEV_B, user_id: a, role: 'viewer' })

    const forA = await fetchStationsForUser(db, { userId: a })
    expect(forA.map((s) => [s.deviceId, s.role])).toEqual([
      [DEV_A, 'owner'],
      [DEV_B, 'viewer'],
    ])
    const forB = await fetchStationsForUser(db, { userId: b })
    expect(forB.map((s) => s.deviceId)).toEqual([DEV_B])
  })

  it('fetchStationForUser returns null for a station the user is not on', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)

    await expect(
      fetchStationForUser(db, { userId: b, deviceId: DEV_A }),
    ).resolves.toBeNull()
    await expect(
      fetchStationForUser(db, { userId: a, deviceId: DEV_A }),
    ).resolves.toMatchObject({ deviceId: DEV_A, role: 'owner' })
  })

  it('writeDeviceProfile stores all four values and reports a refused role', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)
    await db
      .from('device_users')
      .insert({ device_id: DEV_A, user_id: b, role: 'viewer' })

    await expect(
      writeDeviceProfile(db, {
        deviceId: DEV_A,
        userId: a,
        profile: {
          label: 'Roof',
          address: '1 Main St',
          latitude: 50.45,
          longitude: 30.52,
        },
      }),
    ).resolves.toEqual({
      label: 'Roof',
      address: '1 Main St',
      latitude: 50.45,
      longitude: 30.52,
    })

    const refused = writeDeviceProfile(db, {
      deviceId: DEV_A,
      userId: b,
      profile: { label: 'X', address: null, latitude: null, longitude: null },
    })
    await expect(refused).rejects.toBeInstanceOf(ServiceError)
    await expect(refused).rejects.toMatchObject({
      message: DEVICE_PROFILE_FORBIDDEN,
      code: 'P0001',
    })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:integration:secrets -- stations.service`
Expected: FAIL — `fetchStationsForUser` is not exported

- [ ] **Step 3: Implement** — in `apps/web/src/services/devices/devices.service.ts`, add the shared column list above `fetchMyDevices` and use it there (no behaviour change):

```ts
/** device_users row + the station it points at, aliased (CLAUDE.md). */
const STATION_COLUMNS =
  'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at, label, address, latitude, longitude )'
```

In `fetchMyDevices` replace the inline `.select('deviceId:device_id, role, …')` string with `.select(STATION_COLUMNS)`.

Then append at the end of the file:

```ts
/** A membership row whose station is known to exist. */
export type StationRow = MyDevice & {
  device: NonNullable<MyDevice['device']>
}

/**
 * Stations one user is a member of, for the service-role path (public API).
 *
 * NOT interchangeable with fetchMyDevices: that one has no WHERE clause and is
 * correct only on an RLS client, where the policies narrow device_users to the
 * caller's rows. On the service-role client it would return every user's
 * stations. This filters by user_id explicitly, so it is safe on either.
 */
export const fetchStationsForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(STATION_COLUMNS)
    .eq('user_id', params.userId)
    .order('added_at', { ascending: true })

  if (error) {
    throw new ServiceError(
      `Failed to fetch stations: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
  return (data ?? []) as MyDevice[]
}

/** One station for one user, or null when they are not a member. Service-role safe. */
export const fetchStationForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string; deviceId: string },
): Promise<MyDevice | null> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(STATION_COLUMNS)
    .eq('user_id', params.userId)
    .eq('device_id', params.deviceId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch station: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
  return (data as MyDevice | null) ?? null
}

export interface DeviceProfile {
  label: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
}

/** Message of the ServiceError thrown when update_device_profile() refuses the role. */
export const DEVICE_PROFILE_FORBIDDEN = 'DEVICE_PROFILE_FORBIDDEN'

/**
 * Writes the station profile through update_device_profile(), which re-checks
 * the caller's role in SQL. The four values REPLACE the stored ones — callers
 * wanting patch semantics merge first. Returns the row the database holds, or
 * null if the RPC returned none. A refusal by the SQL role check throws
 * ServiceError(DEVICE_PROFILE_FORBIDDEN, 'P0001').
 *
 * updateDeviceProfileAction predates this and calls the RPC itself; the public
 * API's PATCH /stations/{id} is the second caller and goes through here.
 */
export const writeDeviceProfile = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; userId: string; profile: DeviceProfile },
): Promise<DeviceProfile | null> => {
  const { data, error } = await supabase.rpc('update_device_profile', {
    p_device_id: params.deviceId,
    p_user_id: params.userId,
    // `?? undefined`, not null: the generated Args type cannot express a
    // nullable argument; the SQL defaults are null, so omitting the key clears.
    p_label: params.profile.label ?? undefined,
    p_address: params.profile.address ?? undefined,
    p_latitude: params.profile.latitude ?? undefined,
    p_longitude: params.profile.longitude ?? undefined,
  })
  if (error) {
    if (error.code === 'P0001' && error.message === DEVICE_PROFILE_FORBIDDEN) {
      throw new ServiceError(DEVICE_PROFILE_FORBIDDEN, 'P0001')
    }
    throw new ServiceError(
      `Failed to write device profile: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // rpc() rows cannot be aliased (CLAUDE.md). `?? null` is not redundant:
  // gen types cannot infer RETURNS TABLE nullability, so all four arrive typed
  // non-null while every one is nullable in the database.
  const row = data?.[0]
  if (!row) return null
  return {
    label: row.out_label ?? null,
    address: row.out_address ?? null,
    latitude: row.out_latitude ?? null,
    longitude: row.out_longitude ?? null,
  }
}
```

- [ ] **Step 4: Run the new and the existing device tests**

Run: `yarn workspace @ws/web test:integration:secrets -- devices && yarn workspace @ws/web test:unit -- devices`
Expected: PASS (new file: 3 tests; existing device tests unchanged)

- [ ] **Step 5: Commit** (ask first)

```bash
git add apps/web/src/services/devices/devices.service.ts apps/web/tests/integration/services/devices/stations.service.integration.test.ts
git commit -m "feat(devices): service-role-safe station reads and profile write"
```

---

### Task 6: Bearer parsing and response helpers

**Files:**
- Create: `apps/web/src/lib/api/bearer.ts`
- Create: `apps/web/src/lib/api/respond.ts`
- Test: `apps/web/tests/unit/lib/api/bearer.test.ts`
- Test: `apps/web/tests/unit/lib/api/respond.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/tests/unit/lib/api/bearer.test.ts
import { parseBearer } from '@/lib/api/bearer'

describe('parseBearer', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Bearer   abc  ', 'abc'],
  ])('%j → %j', (header, token) => {
    expect(parseBearer(header)).toBe(token)
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['basic auth', 'Basic dXNlcjpwYXNz'],
    ['scheme only', 'Bearer'],
    ['two tokens', 'Bearer a b'],
    ['oversize', `Bearer ${'a'.repeat(257)}`],
  ])('rejects %s', (_label, header) => {
    expect(parseBearer(header)).toBeNull()
  })
})
```

```ts
// apps/web/tests/unit/lib/api/respond.test.ts
import { apiError, apiJson, preflight } from '@/lib/api/respond'

const RESET = new Date(Date.now() + 30_000).toISOString()

describe('API responses', () => {
  it('never lets a response be cached', () => {
    expect(apiJson({}, { cors: false }).headers.get('cache-control')).toBe(
      'no-store',
    )
  })

  it('adds read-only CORS only when asked', () => {
    const open = apiJson({}, { cors: true })
    expect(open.headers.get('access-control-allow-origin')).toBe('*')
    expect(open.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
    expect(open.headers.get('access-control-allow-credentials')).toBeNull()
    expect(
      apiJson({}, { cors: false }).headers.get('access-control-allow-origin'),
    ).toBeNull()
  })

  it('reports rate-limit state in seconds', () => {
    const res = apiJson(
      {},
      { cors: false, rateLimit: { limit: 60, remaining: 7, resetAt: RESET } },
    )
    expect(res.headers.get('ratelimit-limit')).toBe('60')
    expect(res.headers.get('ratelimit-remaining')).toBe('7')
    expect(Number(res.headers.get('ratelimit-reset'))).toBeGreaterThan(28)
  })

  it('builds the error envelope with the code’s status and default message', async () => {
    const res = apiError('NOT_FOUND', { cors: true })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Station not found' },
    })
  })

  it('carries field errors and a custom message', async () => {
    const res = apiError(
      'INVALID_INPUT',
      { cors: false },
      { message: 'Nope', fieldErrors: { from: 'bad' } },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'Nope',
        fieldErrors: { from: 'bad' },
      },
    })
  })

  it('adds Retry-After to a 429', () => {
    const res = apiError('RATE_LIMITED', {
      cors: false,
      rateLimit: { limit: 60, remaining: 0, resetAt: RESET },
    })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(28)
  })

  it('answers preflight with 204 and GET-only CORS', () => {
    const res = preflight()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Authorization',
    )
    expect(res.headers.get('access-control-allow-methods')).not.toContain(
      'PATCH',
    )
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `yarn workspace @ws/web test:unit -- lib/api/bearer lib/api/respond`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `bearer.ts`**

```ts
// apps/web/src/lib/api/bearer.ts
/** Real keys are ~52 characters; anything this long is not one, so it is never hashed. */
const MAX_TOKEN_LENGTH = 256
const BEARER = /^Bearer[ \t]+(\S+)$/i

/**
 * The raw token from an `Authorization: Bearer <token>` header, or null.
 * Knows nothing about key formats — the provider decides what a key looks like.
 */
export const parseBearer = (header: string | null): string | null => {
  if (!header) return null
  const token = BEARER.exec(header.trim())?.[1]
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  return token
}
```

- [ ] **Step 4: Implement `respond.ts`**

```ts
// apps/web/src/lib/api/respond.ts
import type { ApiErrorBody } from '@ws/shared'

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_SCOPE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL'

const ERRORS: Record<ApiErrorCode, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: 'The request is invalid' },
  // One message for missing, malformed, unknown, revoked and expired keys, so
  // a caller cannot tell which keys exist.
  UNAUTHORIZED: { status: 401, message: 'Missing or invalid API key' },
  INSUFFICIENT_SCOPE: {
    status: 403,
    message: 'This API key is read-only — create a read & write key',
  },
  FORBIDDEN: {
    status: 403,
    message: 'Your role on this station does not allow this',
  },
  // Also the answer for stations you are not a member of: whether an id
  // exists is not something a key may learn.
  NOT_FOUND: { status: 404, message: 'Station not found' },
  RATE_LIMITED: { status: 429, message: 'Too many requests for this API key' },
  INTERNAL: { status: 500, message: 'Something went wrong' },
}

export interface RateLimitState {
  limit: number
  remaining: number
  resetAt: string
}

/** What every response of one request shares: CORS policy and limiter state. */
export interface ResponseMeta {
  cors: boolean
  rateLimit?: RateLimitState
}

/**
 * GET-only CORS. Users may call the read endpoints from a small site of their
 * own; no cookies are involved (no Allow-Credentials), so there is no CSRF
 * exposure. PATCH is deliberately absent: a write key in browser JavaScript
 * would let any visitor edit the station.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Expose-Headers':
    'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After',
  'Access-Control-Max-Age': '600',
}

const secondsUntil = (iso: string): number =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000))

const buildHeaders = (
  meta: ResponseMeta,
  extra: Record<string, string> = {},
): Headers => {
  const headers = new Headers({ 'Cache-Control': 'no-store', ...extra })
  if (meta.cors) {
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      headers.set(name, value)
    }
  }
  if (meta.rateLimit) {
    headers.set('RateLimit-Limit', String(meta.rateLimit.limit))
    headers.set('RateLimit-Remaining', String(meta.rateLimit.remaining))
    headers.set('RateLimit-Reset', String(secondsUntil(meta.rateLimit.resetAt)))
  }
  return headers
}

export const apiJson = (
  body: unknown,
  meta: ResponseMeta,
  status = 200,
): Response => Response.json(body, { status, headers: buildHeaders(meta) })

export const apiError = (
  code: ApiErrorCode,
  meta: ResponseMeta,
  options: { message?: string; fieldErrors?: Record<string, string> } = {},
): Response => {
  const body: ApiErrorBody = {
    error: {
      code,
      message: options.message ?? ERRORS[code].message,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    },
  }
  const extra: Record<string, string> =
    code === 'RATE_LIMITED' && meta.rateLimit
      ? { 'Retry-After': String(secondsUntil(meta.rateLimit.resetAt)) }
      : {}
  return Response.json(body, {
    status: ERRORS[code].status,
    headers: buildHeaders(meta, extra),
  })
}

/** OPTIONS handler for every station route — GET-only CORS. */
export const preflight = (): Response =>
  new Response(null, { status: 204, headers: buildHeaders({ cors: true }) })
```

- [ ] **Step 5: Run the tests**

Run: `yarn workspace @ws/web test:unit -- lib/api/bearer lib/api/respond`
Expected: PASS

- [ ] **Step 6: Commit** (ask first)

```bash
git add apps/web/src/lib/api/bearer.ts apps/web/src/lib/api/respond.ts apps/web/tests/unit/lib/api/bearer.test.ts apps/web/tests/unit/lib/api/respond.test.ts
git commit -m "feat(api): bearer parsing and response/CORS helpers"
```

---

### Task 7: `withApiKey`

**Files:**
- Create: `apps/web/src/lib/api/with-api-key.ts`
- Test: `apps/web/tests/unit/lib/api/with-api-key.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/lib/api/with-api-key.test.ts
import { API_RATE_LIMIT } from '@ws/shared'

import type { ApiKeyPrincipal } from '@/lib/api/keys/provider'
import type { RateLimitResult } from '@/services/api-keys/rate-limit.service'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const authenticate = jest.fn<Promise<ApiKeyPrincipal | null>, [string]>()
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({ authenticate: (t: string) => authenticate(t) }),
}))
const hit = jest.fn<Promise<RateLimitResult>, [unknown, unknown]>()
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: (s: unknown, p: unknown) => hit(s, p),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))

import { isApiKeyHandler, withApiKey } from '@/lib/api/with-api-key'
import { ServiceError } from '@/services/database/types'

const TOKEN = `wsk_live_${'a'.repeat(43)}`
const RESET = new Date(Date.now() + 30_000).toISOString()
const request = (headers: Record<string, string> = {
  authorization: `Bearer ${TOKEN}`,
}) => new Request('http://localhost/api/v1/stations', { headers })
const routeCtx = { params: Promise.resolve({}) }
const ok = jest.fn(async () => Response.json({ ok: true }))

beforeEach(() => {
  jest.clearAllMocks()
  authenticate.mockResolvedValue({ keyId: 'k1', userId: 'u1', scope: 'read' })
  hit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: RESET })
})

describe('withApiKey', () => {
  it('answers 401 without a bearer token and never asks the provider', async () => {
    const res = await withApiKey({ scope: 'read', cors: true }, ok)(
      request({}),
      routeCtx,
    )
    expect(res.status).toBe(401)
    expect(authenticate).not.toHaveBeenCalled()
    expect(ok).not.toHaveBeenCalled()
  })

  it('gives an unknown key the same 401 body as a missing one', async () => {
    authenticate.mockResolvedValue(null)
    const handler = withApiKey({ scope: 'read', cors: false }, ok)
    const unknown = await handler(request(), routeCtx)
    const missing = await handler(request({}), routeCtx)
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual(await missing.json())
  })

  it('passes the principal to the handler and sets rate-limit headers', async () => {
    const handler = jest.fn(async () => Response.json({ ok: true }))
    await withApiKey({ scope: 'read', cors: true }, handler)(
      request(),
      routeCtx,
    )
    expect(hit).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        bucket: 'key:k1',
        limit: API_RATE_LIMIT.limit,
        windowSeconds: API_RATE_LIMIT.windowSeconds,
      },
    )
    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        userId: 'u1',
        keyId: 'k1',
        scope: 'read',
        meta: {
          cors: true,
          rateLimit: { limit: API_RATE_LIMIT.limit, remaining: 59, resetAt: RESET },
        },
      }),
      {},
    )
  })

  it('answers 429 with Retry-After when the key is over its limit', async () => {
    hit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: RESET })
    const res = await withApiKey({ scope: 'read', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(ok).not.toHaveBeenCalled()
  })

  it('answers 403 INSUFFICIENT_SCOPE for a read key on a write route — after counting it', async () => {
    const res = await withApiKey({ scope: 'read_write', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    })
    expect(hit).toHaveBeenCalled()
    expect(ok).not.toHaveBeenCalled()
  })

  it('turns a handler failure into a bare 500 and logs the cause', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await withApiKey({ scope: 'read', cors: false }, async () => {
      throw new ServiceError('boom', '42P01', 'secret detail')
    })(request(), routeCtx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('answers 500, not 401, when the provider itself fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    authenticate.mockRejectedValue(new ServiceError('db down'))
    const res = await withApiKey({ scope: 'read', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(500)
    log.mockRestore()
  })

  it('keeps CORS on error responses of GET routes so browsers can read them', async () => {
    const res = await withApiKey({ scope: 'read', cors: true }, ok)(
      request({}),
      routeCtx,
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('marks wrapped handlers so the route registry test can find them', () => {
    expect(isApiKeyHandler(withApiKey({ scope: 'read', cors: true }, ok))).toBe(
      true,
    )
    expect(isApiKeyHandler(ok)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- with-api-key`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/api/with-api-key.ts
import 'server-only'

import type { ApiKeyScope } from '@ws/shared'
import { API_RATE_LIMIT, scopeAllows } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import { parseBearer } from './bearer'
import { getApiKeyProvider } from './keys'
import type { ResponseMeta } from './respond'
import { apiError } from './respond'

import {
  apiKeyRateLimitBucket,
  hitRateLimit,
} from '@/services/api-keys/rate-limit.service'
import { ServiceError } from '@/services/database/types'

type Service = ReturnType<typeof createServiceRoleClient>

/** What a station route handler gets once the key has been accepted. */
export interface ApiContext {
  /** Service-role client — RLS is bypassed, so every query must be scoped in code. */
  service: Service
  /** Internal users.id of the key's owner. */
  userId: string
  keyId: string
  scope: ApiKeyScope
  meta: ResponseMeta
}

type RouteContext<P> = { params: Promise<P> }

export type ApiHandler<P> = (
  req: Request,
  ctx: ApiContext,
  params: P,
) => Promise<Response>

const wrapped = new WeakSet<object>()

/** True for handlers produced by withApiKey — the route registry test relies on it. */
export const isApiKeyHandler = (fn: unknown): boolean =>
  typeof fn === 'function' && wrapped.has(fn)

const logFailure = (req: Request, err: unknown): void => {
  // ServiceError carries the Postgres code/details that identify the fault;
  // the response stays bare. The token is never logged.
  const cause =
    err instanceof ServiceError
      ? { message: err.message, code: err.code, details: err.details }
      : { message: err instanceof Error ? err.message : String(err) }
  console.error(
    `[api] ${req.method} ${new URL(req.url).pathname} failed`,
    cause,
  )
}

/**
 * The only entry point for station routes (spec §5–6): bearer → provider →
 * rate limit → scope, then the handler. Order matters: an over-limit key gets
 * 429 before its scope is judged, and a refused scope still counts against
 * the limit. Never imports a concrete provider — only getApiKeyProvider().
 */
export const withApiKey = <P extends Record<string, string> = Record<string, string>>(
  options: { scope: ApiKeyScope; cors: boolean },
  handler: ApiHandler<P>,
) => {
  const route = async (
    req: Request,
    routeCtx: RouteContext<P>,
  ): Promise<Response> => {
    const baseMeta: ResponseMeta = { cors: options.cors }
    try {
      const token = parseBearer(req.headers.get('authorization'))
      if (!token) return apiError('UNAUTHORIZED', baseMeta)

      const principal = await getApiKeyProvider().authenticate(token)
      if (!principal) return apiError('UNAUTHORIZED', baseMeta)

      const service = createServiceRoleClient()
      const limit = await hitRateLimit(service, {
        bucket: apiKeyRateLimitBucket(principal.keyId),
        limit: API_RATE_LIMIT.limit,
        windowSeconds: API_RATE_LIMIT.windowSeconds,
      })
      const meta: ResponseMeta = {
        cors: options.cors,
        rateLimit: {
          limit: API_RATE_LIMIT.limit,
          remaining: limit.remaining,
          resetAt: limit.resetAt,
        },
      }
      if (!limit.allowed) return apiError('RATE_LIMITED', meta)
      if (!scopeAllows(principal.scope, options.scope)) {
        return apiError('INSUFFICIENT_SCOPE', meta)
      }

      return await handler(
        req,
        {
          service,
          userId: principal.userId,
          keyId: principal.keyId,
          scope: principal.scope,
          meta,
        },
        await routeCtx.params,
      )
    } catch (err) {
      logFailure(req, err)
      return apiError('INTERNAL', baseMeta)
    }
  }
  wrapped.add(route)
  return route
}
```

- [ ] **Step 4: Run the test**

Run: `yarn workspace @ws/web test:unit -- with-api-key`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit** (ask first)

```bash
git add apps/web/src/lib/api/with-api-key.ts apps/web/tests/unit/lib/api/with-api-key.test.ts
git commit -m "feat(api): withApiKey — bearer, provider, rate limit, scope"
```

---

### Task 8: Station gate, DTO mappers, schemas, cursor

**Files:**
- Create: `apps/web/src/lib/api/station-gate.ts`
- Create: `apps/web/src/lib/api/stations.ts`
- Create: `apps/web/src/lib/api/schemas.ts`
- Create: `apps/web/src/lib/api/cursor.ts`
- Test: `apps/web/tests/unit/lib/api/schemas.test.ts`
- Test: `apps/web/tests/unit/lib/api/cursor.test.ts`
- Test: `apps/web/tests/unit/lib/api/stations.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/tests/unit/lib/api/schemas.test.ts
import {
  fieldErrorsFrom,
  readingsQuerySchema,
  resolveWindow,
  stationPatchSchema,
} from '@/lib/api/schemas'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-01T12:00:00.000Z')

describe('resolveWindow', () => {
  it('defaults to [now - default span, now]', () => {
    expect(resolveWindow({}, DAY, 31 * DAY, NOW)).toEqual({
      ok: true,
      window: { from: '2026-09-30T12:00:00.000Z', to: '2026-10-01T12:00:00.000Z' },
    })
  })

  it('anchors a missing from on the given to', () => {
    const r = resolveWindow({ to: '2026-09-01T00:00:00Z' }, DAY, 31 * DAY, NOW)
    expect(r).toEqual({
      ok: true,
      window: { from: '2026-08-31T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' },
    })
  })

  it('rejects from >= to', () => {
    const r = resolveWindow(
      { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      DAY,
      31 * DAY,
      NOW,
    )
    expect(r).toMatchObject({ ok: false, fieldErrors: { from: expect.any(String) } })
  })

  it('rejects a span over the cap', () => {
    const r = resolveWindow(
      { from: '2026-08-01T00:00:00Z', to: '2026-09-02T00:00:00Z' },
      DAY,
      31 * DAY,
      NOW,
    )
    expect(r).toMatchObject({ ok: false })
  })
})

describe('readingsQuerySchema', () => {
  it('defaults the limit and coerces it from the query string', () => {
    expect(readingsQuerySchema.parse({})).toEqual({ limit: 288 })
    expect(readingsQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 })
  })

  it.each([
    ['limit over max', { limit: '1001' }],
    ['limit not a number', { limit: 'abc' }],
    ['from without timezone', { from: '2026-10-01T00:00:00' }],
    ['unknown parameter', { form: '2026-10-01T00:00:00Z' }],
  ])('rejects %s', (_label, input) => {
    expect(readingsQuerySchema.safeParse(input).success).toBe(false)
  })
})

describe('stationPatchSchema', () => {
  it('accepts a partial body with nulls', () => {
    expect(stationPatchSchema.parse({ label: ' Roof ', address: null })).toEqual({
      label: 'Roof',
      address: null,
    })
  })

  it.each([
    ['empty object', {}],
    ['unknown key', { name: 'x' }],
    ['empty string label', { label: '   ' }],
    ['label too long', { label: 'x'.repeat(41) }],
    ['latitude out of range', { latitude: 91 }],
    ['latitude as string', { latitude: '50' }],
  ])('rejects %s', (_label, input) => {
    expect(stationPatchSchema.safeParse(input).success).toBe(false)
  })
})

describe('fieldErrorsFrom', () => {
  it('keys errors by path, and names unknown keys', () => {
    const bad = stationPatchSchema.safeParse({ label: '', nope: 1 })
    expect(bad.success).toBe(false)
    if (bad.success) return
    expect(Object.keys(fieldErrorsFrom(bad.error)).sort()).toEqual([
      'label',
      'nope',
    ])
  })
})
```

```ts
// apps/web/tests/unit/lib/api/cursor.test.ts
import { decodeCursor, encodeCursor } from '@/lib/api/cursor'

describe('readings cursor', () => {
  it('round-trips the last row’s timestamp and id', () => {
    const c = { timestamp: '2026-10-01T08:55:00+00:00', id: 42 }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })

  it.each([
    ['not base64 json', 'garbage'],
    [
      'filter injection in timestamp',
      Buffer.from(JSON.stringify({ timestamp: '2026),id.gt.0', id: 1 })).toString('base64url'),
    ],
    [
      'non-integer id',
      Buffer.from(JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', id: 1.5 })).toString('base64url'),
    ],
    [
      'extra field',
      Buffer.from(JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', id: 1, x: 1 })).toString('base64url'),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull()
  })
})
```

```ts
// apps/web/tests/unit/lib/api/stations.test.ts
import type { StationRow } from '@/services/devices/devices.service'

jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: jest.fn() }))

import { toApiReading, toApiStation, withProfile } from '@/lib/api/stations'

const row: StationRow = {
  deviceId: 'ws-abc123',
  role: 'editor',
  addedAt: '2026-08-16T10:00:00.000Z',
  device: {
    status: 'registered',
    createdAt: '2026-07-10T09:00:00.000Z',
    label: null,
    address: 'Main St 1',
    latitude: 50.45,
    longitude: 30.52,
  },
}

describe('station DTOs', () => {
  it('names an unlabelled station by its id and nests the location', () => {
    expect(toApiStation(row, '2026-10-01T08:55:00+00:00')).toEqual({
      id: 'ws-abc123',
      name: 'ws-abc123',
      label: null,
      address: 'Main St 1',
      location: { latitude: 50.45, longitude: 30.52 },
      role: 'editor',
      status: 'registered',
      addedAt: '2026-08-16T10:00:00.000Z',
      createdAt: '2026-07-10T09:00:00.000Z',
      lastReadingAt: '2026-10-01T08:55:00+00:00',
    })
  })

  it('reports no location unless both coordinates are set', () => {
    const half = { ...row, device: { ...row.device, longitude: null } }
    expect(toApiStation(half, null).location).toBeNull()
  })

  it('applies a stored profile over the row', () => {
    const updated = withProfile(row, {
      label: 'Roof',
      address: null,
      latitude: null,
      longitude: null,
    })
    expect(toApiStation(updated, null)).toMatchObject({
      name: 'Roof',
      address: null,
      location: null,
    })
  })

  it('drops internal fields from a reading', () => {
    expect(
      toApiReading({
        id: 7,
        deviceId: 'ws-abc123',
        timestamp: 't',
        temperature: 1,
        humidity: null,
        pressure: 1000,
        windSpeed: null,
        windDirection: null,
        precipitation: null,
      }),
    ).toEqual({
      timestamp: 't',
      temperature: 1,
      humidity: null,
      pressure: 1000,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `yarn workspace @ws/web test:unit -- lib/api/schemas lib/api/cursor lib/api/stations`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement `schemas.ts`**

```ts
// apps/web/src/lib/api/schemas.ts
import {
  API_AGGREGATE_DEFAULT_INTERVAL,
  API_AGGREGATE_INTERVALS,
  API_READINGS_PAGE_DEFAULT,
  API_READINGS_PAGE_MAX,
} from '@ws/shared'
import type { ZodError } from 'zod'
import { z } from 'zod'

const DAY_MS = 86_400_000

const isoDatetime = z.string().datetime({
  offset: true,
  message: 'Use an ISO 8601 datetime with a timezone, e.g. 2026-10-01T00:00:00Z',
})

/** GET /stations/{id}/readings. `.strict()` so a typo like `form=` is a 400, not a silent default. */
export const readingsQuerySchema = z
  .object({
    from: isoDatetime.optional(),
    to: isoDatetime.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(API_READINGS_PAGE_MAX)
      .default(API_READINGS_PAGE_DEFAULT),
    cursor: z.string().max(512).optional(),
  })
  .strict()

/** GET /stations/{id}/readings/aggregate. */
export const aggregateQuerySchema = z
  .object({
    from: isoDatetime.optional(),
    to: isoDatetime.optional(),
    interval: z
      .enum(API_AGGREGATE_INTERVALS)
      .default(API_AGGREGATE_DEFAULT_INTERVAL),
  })
  .strict()

const clearableText = (max: number, field: string) =>
  z
    .string()
    .trim()
    .min(1, `Send null to clear the ${field}`)
    .max(max, `Keep the ${field} under ${max} characters`)
    .nullable()
    .optional()

/**
 * PATCH /stations/{id}: omitted = keep, null = clear. Same limits as the
 * Settings form and the devices check constraints (label 1–40, address 1–200).
 */
export const stationPatchSchema = z
  .object({
    label: clearableText(40, 'nickname'),
    address: clearableText(200, 'address'),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Send at least one of label, address, latitude, longitude',
  })

/** First message per field; unknown keys are named; a body-level issue is "body". */
export const fieldErrorsFrom = (error: ZodError): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const keys =
      issue.code === 'unrecognized_keys'
        ? issue.keys
        : [issue.path.length > 0 ? issue.path.join('.') : 'body']
    for (const key of keys) out[key] ??= issue.message
  }
  return out
}

export interface TimeWindow {
  from: string
  to: string
}

/**
 * `to` defaults to now, `from` to `to - defaultSpanMs`; from < to and the span
 * is capped. Returns ISO strings normalised to UTC.
 */
export const resolveWindow = (
  input: { from?: string; to?: string },
  defaultSpanMs: number,
  maxSpanMs: number,
  now: number = Date.now(),
):
  | { ok: true; window: TimeWindow }
  | { ok: false; fieldErrors: Record<string, string> } => {
  const toMs = input.to ? Date.parse(input.to) : now
  const fromMs = input.from ? Date.parse(input.from) : toMs - defaultSpanMs
  if (fromMs >= toMs) {
    return { ok: false, fieldErrors: { from: '`from` must be earlier than `to`' } }
  }
  if (toMs - fromMs > maxSpanMs) {
    const days = Number((maxSpanMs / DAY_MS).toFixed(1))
    return {
      ok: false,
      fieldErrors: { from: `The window may span at most ${days} days` },
    }
  }
  return {
    ok: true,
    window: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
  }
}
```

- [ ] **Step 4: Implement `cursor.ts`**

```ts
// apps/web/src/lib/api/cursor.ts
import { z } from 'zod'

import type { ReadingsCursor } from '@/services/readings/readings.service'

/**
 * Validated before use: fetchReadingsPage interpolates the timestamp into a
 * PostgREST filter, so a tampered cursor must never reach it.
 */
const cursorSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    id: z.number().int().positive(),
  })
  .strict()

/** Opaque to clients: base64url JSON of the last row's (timestamp, id). */
export const encodeCursor = (cursor: ReadingsCursor): string =>
  Buffer.from(
    JSON.stringify({ timestamp: cursor.timestamp, id: cursor.id }),
  ).toString('base64url')

export const decodeCursor = (raw: string): ReadingsCursor | null => {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Implement `stations.ts`**

```ts
// apps/web/src/lib/api/stations.ts
import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiReading, ApiStation, Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import type {
  DeviceProfile,
  StationRow,
} from '@/services/devices/devices.service'
import {
  deviceDisplayName,
  fetchStationsForUser,
} from '@/services/devices/devices.service'
import { fetchLatestReading } from '@/services/readings/readings.service'

/**
 * Response shaping for the public API. This is not row aliasing (the queries
 * alias in .select()); it builds the documented contract — a nested location,
 * a display name — from rows that are already camelCase.
 */
export const toApiStation = (
  row: StationRow,
  lastReadingAt: string | null,
): ApiStation => ({
  id: row.deviceId,
  name: deviceDisplayName(row),
  label: row.device.label,
  address: row.device.address,
  location:
    row.device.latitude !== null && row.device.longitude !== null
      ? { latitude: row.device.latitude, longitude: row.device.longitude }
      : null,
  role: row.role,
  status: row.device.status,
  addedAt: row.addedAt,
  createdAt: row.device.createdAt,
  lastReadingAt,
})

export const withProfile = (
  row: StationRow,
  profile: DeviceProfile,
): StationRow => ({ ...row, device: { ...row.device, ...profile } })

/** Drops `id` / `deviceId`, which are internal to the readings table. */
export const toApiReading = (r: Reading): ApiReading => ({
  timestamp: r.timestamp,
  temperature: r.temperature,
  humidity: r.humidity,
  pressure: r.pressure,
  windSpeed: r.windSpeed,
  windDirection: r.windDirection,
  precipitation: r.precipitation,
})

export const lastReadingAt = async (
  service: SupabaseClient<Database>,
  deviceId: string,
): Promise<string | null> =>
  (await fetchLatestReading(service, { deviceId }))?.timestamp ?? null

/** Every station the user is a member of, with its last reading time. */
export const listStations = async (
  service: SupabaseClient<Database>,
  userId: string,
): Promise<ApiStation[]> => {
  const rows = await fetchStationsForUser(service, { userId })
  // device is null only if the embedded join came back empty; device_users
  // cascades on device delete, so such a row is skipped rather than reported.
  const stations = rows.flatMap((row) =>
    row.device ? [{ ...row, device: row.device }] : [],
  )
  return Promise.all(
    stations.map(async (row) =>
      toApiStation(row, await lastReadingAt(service, row.deviceId)),
    ),
  )
}
```

- [ ] **Step 6: Implement `station-gate.ts`**

```ts
// apps/web/src/lib/api/station-gate.ts
import 'server-only'

import type { DeviceRole } from '@ws/shared'

import { apiError } from './respond'
import type { ApiContext } from './with-api-key'

import type { StationRow } from '@/services/devices/devices.service'
import { fetchStationForUser } from '@/services/devices/devices.service'

const STATION_ID = /^[A-Za-z0-9_-]{1,64}$/

export const anyMember = (): boolean => true

/**
 * The membership gate for every /stations/{id} route — RLS is bypassed on this
 * path, so this is the check. One query returns both the role and the station.
 * Not a member, unknown and malformed ids all answer the same 404. `allows` is
 * a predicate from @ws/shared (canEditDeviceProfile…) — never re-spelled here.
 */
export const requireStation = async (
  ctx: ApiContext,
  stationId: string,
  allows: (role: DeviceRole) => boolean = anyMember,
  forbiddenMessage?: string,
): Promise<
  { ok: true; station: StationRow } | { ok: false; response: Response }
> => {
  if (!STATION_ID.test(stationId)) {
    return { ok: false, response: apiError('NOT_FOUND', ctx.meta) }
  }
  const row = await fetchStationForUser(ctx.service, {
    userId: ctx.userId,
    deviceId: stationId,
  })
  if (!row?.device) {
    return { ok: false, response: apiError('NOT_FOUND', ctx.meta) }
  }
  if (!allows(row.role)) {
    return {
      ok: false,
      response: apiError(
        'FORBIDDEN',
        ctx.meta,
        forbiddenMessage ? { message: forbiddenMessage } : {},
      ),
    }
  }
  return { ok: true, station: { ...row, device: row.device } }
}
```

- [ ] **Step 7: Run the tests**

Run: `yarn workspace @ws/web test:unit -- lib/api`
Expected: PASS

- [ ] **Step 8: Commit** (ask first)

```bash
git add apps/web/src/lib/api apps/web/tests/unit/lib/api
git commit -m "feat(api): station gate, DTO mappers, query schemas, cursor"
```

---

### Task 9: `/stations` and `/stations/{stationId}` routes

**Files:**
- Create: `apps/web/src/app/api/v1/stations/route.ts`
- Create: `apps/web/src/app/api/v1/stations/[stationId]/route.ts`
- Create: `apps/web/tests/unit/app/api/v1/stations/fixtures.ts`
- Test: `apps/web/tests/unit/app/api/v1/stations/stations.route.test.ts`

- [ ] **Step 1: Write the shared fixtures (not a test file — no `jest.mock` here)**

```ts
// apps/web/tests/unit/app/api/v1/stations/fixtures.ts
import type { DeviceRole } from '@ws/shared'

import type { StationRow } from '@/services/devices/devices.service'

export const TOKEN = `wsk_live_${'a'.repeat(43)}`
export const RESET = new Date(Date.now() + 30_000).toISOString()

export const stationRow = (
  role: DeviceRole = 'owner',
  device: Partial<StationRow['device']> = {},
): StationRow => ({
  deviceId: 'ws-abc123',
  role,
  addedAt: '2026-08-16T10:00:00.000Z',
  device: {
    status: 'registered',
    createdAt: '2026-07-10T09:00:00.000Z',
    label: 'Balcony',
    address: 'Main St 1',
    latitude: 50.45,
    longitude: 30.52,
    ...device,
  },
})

export const apiRequest = (
  path: string,
  init: { method?: string; body?: unknown; rawBody?: string } = {},
): Request =>
  new Request(`http://localhost/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body:
      init.rawBody ??
      (init.body === undefined ? undefined : JSON.stringify(init.body)),
  })

export const params = <P extends Record<string, string>>(p: P) => ({
  params: Promise.resolve(p),
})
```

- [ ] **Step 2: Write the failing route test**

```ts
// apps/web/tests/unit/app/api/v1/stations/stations.route.test.ts
import type { ApiKeyPrincipal } from '@/lib/api/keys/provider'
import type {
  DeviceProfile,
  MyDevice,
} from '@/services/devices/devices.service'

import { apiRequest, params, RESET, stationRow } from './fixtures'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const authenticate = jest.fn<Promise<ApiKeyPrincipal | null>, [string]>()
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({ authenticate: (t: string) => authenticate(t) }),
}))
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: async () => ({ allowed: true, remaining: 59, resetAt: RESET }),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))
const fetchStations = jest.fn<Promise<MyDevice[]>, [unknown, unknown]>()
const fetchStation = jest.fn<Promise<MyDevice | null>, [unknown, unknown]>()
const writeProfile = jest.fn<Promise<DeviceProfile | null>, [unknown, unknown]>()
jest.mock('@/services/devices/devices.service', () => ({
  ...jest.requireActual('@/services/devices/devices.service'),
  fetchStationsForUser: (s: unknown, p: unknown) => fetchStations(s, p),
  fetchStationForUser: (s: unknown, p: unknown) => fetchStation(s, p),
  writeDeviceProfile: (s: unknown, p: unknown) => writeProfile(s, p),
}))
jest.mock('@/services/readings/readings.service', () => ({
  fetchLatestReading: async () => ({ timestamp: '2026-10-01T08:55:00+00:00' }),
}))

import * as stationRoute from '@/app/api/v1/stations/[stationId]/route'
import * as stationsRoute from '@/app/api/v1/stations/route'
import { ServiceError } from '@/services/database/types'

const asKey = (scope: ApiKeyPrincipal['scope']) =>
  authenticate.mockResolvedValue({ keyId: 'k1', userId: 'u1', scope })

const patch = (body: unknown) =>
  stationRoute.PATCH(
    apiRequest('/stations/ws-abc123', { method: 'PATCH', body }),
    params({ stationId: 'ws-abc123' }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  asKey('read_write')
  fetchStation.mockResolvedValue(stationRow('owner'))
  writeProfile.mockImplementation(async (_s, p) => (p as { profile: DeviceProfile }).profile)
})

describe('GET /stations', () => {
  it('lists the key owner’s stations with their last reading', async () => {
    fetchStations.mockResolvedValue([
      stationRow('owner'),
      { ...stationRow('viewer'), deviceId: 'ws-shared', device: null },
    ])
    const res = await stationsRoute.GET(apiRequest('/stations'), params({}))
    expect(res.status).toBe(200)
    expect(fetchStations).toHaveBeenCalledWith(
      { __brand: 'service' },
      { userId: 'u1' },
    )
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([
      expect.objectContaining({
        id: 'ws-abc123',
        name: 'Balcony',
        role: 'owner',
        lastReadingAt: '2026-10-01T08:55:00+00:00',
      }),
    ])
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('GET /stations/{id}', () => {
  it('returns the station to a member', async () => {
    asKey('read')
    const res = await stationRoute.GET(
      apiRequest('/stations/ws-abc123'),
      params({ stationId: 'ws-abc123' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      data: { id: 'ws-abc123', location: { latitude: 50.45, longitude: 30.52 } },
    })
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    const res = await stationRoute.GET(
      apiRequest('/stations/ws-other'),
      params({ stationId: 'ws-other' }),
    )
    expect(res.status).toBe(404)
  })

  it('answers 404 to a malformed id without querying', async () => {
    const res = await stationRoute.GET(
      apiRequest('/stations/x'),
      params({ stationId: 'a'.repeat(65) }),
    )
    expect(res.status).toBe(404)
    expect(fetchStation).not.toHaveBeenCalled()
  })
})

describe('PATCH /stations/{id}', () => {
  it('refuses a read-only key before reading the body', async () => {
    asKey('read')
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    })
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it('refuses a viewer with FORBIDDEN', async () => {
    fetchStation.mockResolvedValue(stationRow('viewer'))
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(writeProfile).not.toHaveBeenCalled()
  })

  // Narrowing canEditDeviceProfile to owners must fail here (CLAUDE.md,
  // "Mutating either predicate must fail tests on both sides").
  it('lets an editor write', async () => {
    fetchStation.mockResolvedValue(stationRow('editor'))
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(200)
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await patch({ label: 'Roof' })).status).toBe(404)
  })

  it('keeps omitted fields and clears nulls', async () => {
    await patch({ address: null })
    expect(writeProfile).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        userId: 'u1',
        profile: {
          label: 'Balcony',
          address: null,
          latitude: 50.45,
          longitude: 30.52,
        },
      },
    )
  })

  it('rejects half a coordinate pair', async () => {
    const res = await patch({ latitude: null })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { fieldErrors: { latitude: expect.any(String) } },
    })
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it.each([
    ['empty body', {}],
    ['unknown key', { name: 'x' }],
  ])('rejects %s', async (_label, body) => {
    expect((await patch(body)).status).toBe(400)
  })

  it('rejects a body that is not JSON', async () => {
    const res = await stationRoute.PATCH(
      apiRequest('/stations/ws-abc123', { method: 'PATCH', rawBody: '{nope' }),
      params({ stationId: 'ws-abc123' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns the row the database stored, not the input', async () => {
    writeProfile.mockResolvedValue({
      label: 'Stored',
      address: 'Main St 1',
      latitude: 50.45,
      longitude: 30.52,
    })
    const res = await patch({ label: 'Roof' })
    expect(await res.json()).toMatchObject({
      data: { label: 'Stored', name: 'Stored' },
    })
  })

  it('logs and answers 403 when the SQL check disagrees with the gate', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    writeProfile.mockRejectedValue(
      new ServiceError('DEVICE_PROFILE_FORBIDDEN', 'P0001'),
    )
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('gate and RPC disagree'),
      expect.objectContaining({ role: 'owner' }),
    )
    log.mockRestore()
  })

  it('carries no CORS headers, so browsers cannot send it', async () => {
    const res = await patch({ label: 'Roof' })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('OPTIONS', () => {
  it('allows GET only', () => {
    const res = stationRoute.OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- stations.route`
Expected: FAIL — route modules not found

- [ ] **Step 4: Implement `/stations`**

```ts
// apps/web/src/app/api/v1/stations/route.ts
import 'server-only'

import { apiJson, preflight } from '@/lib/api/respond'
import { listStations } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Every station the key's owner is a member of — owned and shared. */
export const GET = withApiKey({ scope: 'read', cors: true }, async (_req, ctx) =>
  apiJson({ data: await listStations(ctx.service, ctx.userId) }, ctx.meta),
)

export const OPTIONS = preflight
```

- [ ] **Step 5: Implement `/stations/{stationId}`**

```ts
// apps/web/src/app/api/v1/stations/[stationId]/route.ts
import 'server-only'

import { canEditDeviceProfile } from '@ws/shared'

import { apiError, apiJson, preflight } from '@/lib/api/respond'
import { fieldErrorsFrom, stationPatchSchema } from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { lastReadingAt, toApiStation, withProfile } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { ServiceError } from '@/services/database/types'
import type { DeviceProfile } from '@/services/devices/devices.service'
import {
  DEVICE_PROFILE_FORBIDDEN,
  writeDeviceProfile,
} from '@/services/devices/devices.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

const FORBIDDEN_EDIT = 'Only owners and editors can edit this station'

export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (_req, ctx, { stationId }) => {
    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response
    return apiJson(
      {
        data: toApiStation(
          gate.station,
          await lastReadingAt(ctx.service, stationId),
        ),
      },
      ctx.meta,
    )
  },
)

/**
 * Station details for owners and editors (canEditDeviceProfile). Omitted keeps,
 * null clears — merged here because update_device_profile() replaces all four
 * columns. No CORS: a write key must not live in browser JavaScript.
 */
export const PATCH = withApiKey<Params>(
  { scope: 'read_write', cors: false },
  async (req, ctx, { stationId }) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiError('INVALID_INPUT', ctx.meta, {
        message: 'Send a JSON object',
      })
    }
    const parsed = stationPatchSchema.safeParse(body)
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }

    const gate = await requireStation(
      ctx,
      stationId,
      canEditDeviceProfile,
      FORBIDDEN_EDIT,
    )
    if (!gate.ok) return gate.response

    const current = gate.station.device
    const patch = parsed.data
    const merged: DeviceProfile = {
      label: patch.label !== undefined ? patch.label : current.label,
      address: patch.address !== undefined ? patch.address : current.address,
      latitude: patch.latitude !== undefined ? patch.latitude : current.latitude,
      longitude:
        patch.longitude !== undefined ? patch.longitude : current.longitude,
    }
    // Mirrors devices_coords_both_or_neither, as a field error instead of a 23514.
    if ((merged.latitude === null) !== (merged.longitude === null)) {
      const missing = merged.latitude === null ? 'latitude' : 'longitude'
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: {
          [missing]: 'Send latitude and longitude together, or null both',
        },
      })
    }

    let stored: DeviceProfile | null
    try {
      stored = await writeDeviceProfile(ctx.service, {
        deviceId: stationId,
        userId: ctx.userId,
        profile: merged,
      })
    } catch (err) {
      if (err instanceof ServiceError && err.message === DEVICE_PROFILE_FORBIDDEN) {
        // The TypeScript gate and the SQL check reached opposite conclusions —
        // the anomaly update_device_profile() exists to catch.
        console.error('[api] PATCH station: gate and RPC disagree', {
          stationId,
          userId: ctx.userId,
          role: gate.station.role,
        })
        return apiError('FORBIDDEN', ctx.meta, { message: FORBIDDEN_EDIT })
      }
      throw err
    }
    if (!stored) return apiError('NOT_FOUND', ctx.meta)

    return apiJson(
      {
        data: toApiStation(
          withProfile(gate.station, stored),
          await lastReadingAt(ctx.service, stationId),
        ),
      },
      ctx.meta,
    )
  },
)

export const OPTIONS = preflight
```

- [ ] **Step 6: Run the test**

Run: `yarn workspace @ws/web test:unit -- stations.route`
Expected: PASS

- [ ] **Step 7: Commit** (ask first)

```bash
git add apps/web/src/app/api/v1/stations/route.ts "apps/web/src/app/api/v1/stations/[stationId]/route.ts" apps/web/tests/unit/app/api/v1/stations
git commit -m "feat(api): GET /stations, GET+PATCH /stations/{id}"
```

---

### Task 10: Readings routes — latest, raw, aggregate

**Files:**
- Create: `apps/web/src/app/api/v1/stations/[stationId]/readings/route.ts`
- Create: `apps/web/src/app/api/v1/stations/[stationId]/readings/latest/route.ts`
- Create: `apps/web/src/app/api/v1/stations/[stationId]/readings/aggregate/route.ts`
- Test: `apps/web/tests/unit/app/api/v1/stations/readings.route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/app/api/v1/stations/readings.route.test.ts
import type { Reading } from '@ws/shared'

import type { BucketedRow } from '@/lib/chart'
import type { MyDevice } from '@/services/devices/devices.service'

import { apiRequest, params, RESET, stationRow } from './fixtures'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({
    authenticate: async () => ({ keyId: 'k1', userId: 'u1', scope: 'read' }),
  }),
}))
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: async () => ({ allowed: true, remaining: 59, resetAt: RESET }),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))
const fetchStation = jest.fn<Promise<MyDevice | null>, [unknown, unknown]>()
jest.mock('@/services/devices/devices.service', () => ({
  ...jest.requireActual('@/services/devices/devices.service'),
  fetchStationForUser: (s: unknown, p: unknown) => fetchStation(s, p),
}))
const latest = jest.fn<Promise<Reading | null>, [unknown, unknown]>()
const page = jest.fn<Promise<Reading[]>, [unknown, unknown]>()
const bucketed = jest.fn<Promise<BucketedRow[]>, [unknown, unknown]>()
jest.mock('@/services/readings/readings.service', () => ({
  fetchLatestReading: (s: unknown, p: unknown) => latest(s, p),
  fetchReadingsPage: (s: unknown, p: unknown) => page(s, p),
  fetchReadingsBucketed: (s: unknown, p: unknown) => bucketed(s, p),
}))

import * as aggregateRoute from '@/app/api/v1/stations/[stationId]/readings/aggregate/route'
import * as latestRoute from '@/app/api/v1/stations/[stationId]/readings/latest/route'
import * as rawRoute from '@/app/api/v1/stations/[stationId]/readings/route'
import { encodeCursor } from '@/lib/api/cursor'

const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const ID = { stationId: 'ws-abc123' }
const reading = (id: number, timestamp: string): Reading => ({
  id,
  deviceId: 'ws-abc123',
  timestamp,
  temperature: 20,
  humidity: 50,
  pressure: 1013,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})
const raw = (query = '') =>
  rawRoute.GET(apiRequest(`/stations/ws-abc123/readings${query}`), params(ID))
const aggregate = (query = '') =>
  aggregateRoute.GET(
    apiRequest(`/stations/ws-abc123/readings/aggregate${query}`),
    params(ID),
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  fetchStation.mockResolvedValue(stationRow('viewer'))
  page.mockResolvedValue([])
  bucketed.mockResolvedValue([])
})
afterEach(() => jest.restoreAllMocks())

describe('GET …/readings/latest', () => {
  it('returns the reading without internal fields', async () => {
    latest.mockResolvedValue(reading(7, '2026-10-01T11:55:00+00:00'))
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(await res.json()).toEqual({
      data: {
        timestamp: '2026-10-01T11:55:00+00:00',
        temperature: 20,
        humidity: 50,
        pressure: 1013,
        windSpeed: null,
        windDirection: null,
        precipitation: null,
      },
    })
  })

  it('returns null for a station that never reported', async () => {
    latest.mockResolvedValue(null)
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(await res.json()).toEqual({ data: null })
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(res.status).toBe(404)
    expect(latest).not.toHaveBeenCalled()
  })
})

describe('GET …/readings', () => {
  it('defaults to the last 24 h, 288 rows, no cursor', async () => {
    const res = await raw()
    expect(res.status).toBe(200)
    expect(page).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        from: '2026-09-30T12:00:00.000Z',
        to: '2026-10-01T12:00:00.000Z',
        cursor: null,
        limit: 288,
      },
    )
    expect(await res.json()).toEqual({ data: [], nextCursor: null })
  })

  it('returns a cursor to the last row when the page is full', async () => {
    page.mockResolvedValue([
      reading(1, '2026-10-01T11:50:00+00:00'),
      reading(2, '2026-10-01T11:55:00+00:00'),
    ])
    const body = (await (await raw('?limit=2')).json()) as {
      nextCursor: string
    }
    expect(body.nextCursor).toBe(
      encodeCursor({ timestamp: '2026-10-01T11:55:00+00:00', id: 2 }),
    )
  })

  it('passes a returned cursor back to the service', async () => {
    const cursor = encodeCursor({ timestamp: '2026-10-01T11:55:00+00:00', id: 2 })
    await raw(`?cursor=${cursor}`)
    expect(page).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cursor: { timestamp: '2026-10-01T11:55:00+00:00', id: 2 },
      }),
    )
  })

  it.each([
    ['tampered cursor', '?cursor=bm9wZQ'],
    ['limit over max', '?limit=1001'],
    ['span over 31 days', '?from=2026-08-01T00:00:00Z&to=2026-09-02T00:00:00Z'],
    ['from after to', '?from=2026-10-01T00:00:00Z&to=2026-09-01T00:00:00Z'],
    ['unknown parameter', '?form=2026-10-01T00:00:00Z'],
  ])('rejects %s with 400', async (_label, query) => {
    const res = await raw(query)
    expect(res.status).toBe(400)
    expect(page).not.toHaveBeenCalled()
  })

  it('answers 404 to a non-member after validating', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await raw()).status).toBe(404)
  })
})

describe('GET …/readings/aggregate', () => {
  it('defaults to hourly buckets over the last 7 days', async () => {
    const res = await aggregate()
    expect(res.status).toBe(200)
    expect(bucketed).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        from: '2026-09-24T12:00:00.000Z',
        to: '2026-10-01T12:00:00.000Z',
        bucketMinutes: 60,
      },
    )
    expect(await res.json()).toEqual({ data: [], interval: '1h' })
  })

  it('allows a year of daily buckets', async () => {
    const res = await aggregate(
      '?interval=1d&from=2025-10-01T00:00:00Z&to=2026-10-01T00:00:00Z',
    )
    expect(res.status).toBe(200)
    expect(bucketed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucketMinutes: 1440 }),
    )
  })

  it.each([
    ['more than 1000 hourly buckets', '?interval=1h&from=2026-08-01T00:00:00Z&to=2026-09-15T00:00:00Z'],
    ['an unknown interval', '?interval=5m'],
  ])('rejects %s', async (_label, query) => {
    expect((await aggregate(query)).status).toBe(400)
    expect(bucketed).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- readings.route`
Expected: FAIL — route modules not found

- [ ] **Step 3: Implement latest**

```ts
// apps/web/src/app/api/v1/stations/[stationId]/readings/latest/route.ts
import 'server-only'

import { apiJson, preflight } from '@/lib/api/respond'
import { requireStation } from '@/lib/api/station-gate'
import { toApiReading } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchLatestReading } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (_req, ctx, { stationId }) => {
    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response
    const reading = await fetchLatestReading(ctx.service, {
      deviceId: stationId,
    })
    return apiJson({ data: reading ? toApiReading(reading) : null }, ctx.meta)
  },
)

export const OPTIONS = preflight
```

- [ ] **Step 4: Implement raw history**

```ts
// apps/web/src/app/api/v1/stations/[stationId]/readings/route.ts
import 'server-only'

import {
  API_READINGS_DEFAULT_SPAN_MS,
  API_READINGS_MAX_SPAN_MS,
} from '@ws/shared'

import { decodeCursor, encodeCursor } from '@/lib/api/cursor'
import { apiError, apiJson, preflight } from '@/lib/api/respond'
import {
  fieldErrorsFrom,
  readingsQuerySchema,
  resolveWindow,
} from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { toApiReading } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchReadingsPage } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

/**
 * Raw 5-minute readings, ascending, keyset-paginated. A full page carries
 * `nextCursor`; callers pass it back with the same from/to.
 */
export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (req, ctx, { stationId }) => {
    const parsed = readingsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }
    const query = parsed.data
    const cursor =
      query.cursor === undefined ? null : decodeCursor(query.cursor)
    if (query.cursor !== undefined && !cursor) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: { cursor: 'Pass back the nextCursor value unchanged' },
      })
    }
    const window = resolveWindow(
      query,
      API_READINGS_DEFAULT_SPAN_MS,
      API_READINGS_MAX_SPAN_MS,
    )
    if (!window.ok) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: window.fieldErrors,
      })
    }

    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response

    const rows = await fetchReadingsPage(ctx.service, {
      deviceId: stationId,
      from: window.window.from,
      to: window.window.to,
      cursor,
      limit: query.limit,
    })
    const last = rows.at(-1)
    const nextCursor =
      rows.length === query.limit && last
        ? encodeCursor({ timestamp: last.timestamp, id: last.id })
        : null
    return apiJson({ data: rows.map(toApiReading), nextCursor }, ctx.meta)
  },
)

export const OPTIONS = preflight
```

- [ ] **Step 5: Implement aggregate**

```ts
// apps/web/src/app/api/v1/stations/[stationId]/readings/aggregate/route.ts
import 'server-only'

import {
  API_AGGREGATE_DEFAULT_SPAN_MS,
  API_AGGREGATE_INTERVAL_MINUTES,
  aggregateMaxSpanMs,
} from '@ws/shared'

import { apiError, apiJson, preflight } from '@/lib/api/respond'
import {
  aggregateQuerySchema,
  fieldErrorsFrom,
  resolveWindow,
} from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchReadingsBucketed } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

/** min/avg/max per bucket via readings_bucketed(); at most 1000 buckets per request. */
export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (req, ctx, { stationId }) => {
    const parsed = aggregateQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }
    const { interval } = parsed.data
    const window = resolveWindow(
      parsed.data,
      API_AGGREGATE_DEFAULT_SPAN_MS,
      aggregateMaxSpanMs(interval),
    )
    if (!window.ok) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: window.fieldErrors,
      })
    }

    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response

    const rows = await fetchReadingsBucketed(ctx.service, {
      deviceId: stationId,
      from: window.window.from,
      to: window.window.to,
      bucketMinutes: API_AGGREGATE_INTERVAL_MINUTES[interval],
    })
    return apiJson({ data: rows, interval }, ctx.meta)
  },
)

export const OPTIONS = preflight
```

- [ ] **Step 6: Run the test**

Run: `yarn workspace @ws/web test:unit -- readings.route`
Expected: PASS

- [ ] **Step 7: Commit** (ask first)

```bash
git add "apps/web/src/app/api/v1/stations/[stationId]/readings" apps/web/tests/unit/app/api/v1/stations/readings.route.test.ts
git commit -m "feat(api): latest, raw and aggregated readings endpoints"
```

---

### Task 11: Guard tests — every route gated, no concrete provider, routes public

**Files:**
- Test: `apps/web/tests/unit/app/api/v1/stations/registry.test.ts`
- Modify: `apps/web/tests/unit/lib/auth/public-routes.test.ts`

- [ ] **Step 1: Write the registry test**

```ts
// apps/web/tests/unit/app/api/v1/stations/registry.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: jest.fn() }))

import { preflight } from '@/lib/api/respond'
import { apiKeyHandlerOptions } from '@/lib/api/with-api-key'

/**
 * Every station route runs on the service-role client, so a handler exported
 * without withApiKey would be an unauthenticated read of the whole database.
 * This walks the folder instead of listing routes, so a new route.ts is
 * covered the moment it exists.
 */
const WEB = join(__dirname, '../../../../../..')
const STATIONS_DIR = join(WEB, 'src/app/api/v1/stations')
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
// Any own-*/clerk-* module (provider or key-format helpers) is implementation detail.
const CONCRETE_PROVIDER = /lib\/api\/keys\/(own|clerk)-/

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routeFiles(join(dir, entry.name))
      : entry.name === 'route.ts'
        ? [join(dir, entry.name)]
        : [],
  )

const files = routeFiles(STATIONS_DIR).map(
  (file) => [relative(STATIONS_DIR, file), file] as const,
)

describe('station API routes', () => {
  it('finds all five route files', () => {
    expect(files).toHaveLength(5)
  })

  it.each(files)(
    '%s: every handler is wrapped in withApiKey, with the right options',
    async (_name, file) => {
      const mod = (await import(file)) as Record<string, unknown>
      const exported = METHODS.filter((m) => mod[m] !== undefined)
      expect(exported.length).toBeGreaterThan(0)
      for (const method of exported) {
        const options = apiKeyHandlerOptions(mod[method])
        // Reads: read scope, CORS on. Writes: read_write scope, CORS off —
        // a write key must never be usable from browser JavaScript.
        const expected =
          method === 'GET' || method === 'HEAD'
            ? { scope: 'read', cors: true }
            : { scope: 'read_write', cors: false }
        expect([method, options]).toEqual([method, expected])
      }
      expect(mod.OPTIONS).toBe(preflight)
    },
  )

  it.each(files)('%s: never imports a concrete key provider', (_name, file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(CONCRETE_PROVIDER)
  })

  it.each(['src/lib/api/with-api-key.ts', 'src/actions/api-keys.action.ts'])(
    '%s reaches keys only through getApiKeyProvider',
    (path) => {
      expect(readFileSync(join(WEB, path), 'utf8')).not.toMatch(
        CONCRETE_PROVIDER,
      )
    },
  )
})
```

- [ ] **Step 2: Add public-route cases** — in `apps/web/tests/unit/lib/auth/public-routes.test.ts`, add these rows to the `it.each` table after `['/api/v1/openapi.json', true],`:

```ts
    // Key-authenticated: Clerk must let these through to withApiKey.
    ['/api/v1/stations', true],
    ['/api/v1/stations/ws-abc123/readings/aggregate', true],
```

- [ ] **Step 3: Run both**

Run: `yarn workspace @ws/web test:unit -- registry public-routes`
Expected: PASS (registry: 1 + 5 + 5 + 1 tests)

- [ ] **Step 4: Prove the registry test bites** — temporarily change `export const OPTIONS = preflight` in `apps/web/src/app/api/v1/stations/route.ts` to `export const OPTIONS = () => preflight()` and re-run; expected FAIL on that file. Revert.

- [ ] **Step 5: Commit** (ask first)

```bash
git add apps/web/tests/unit/app/api/v1/stations/registry.test.ts apps/web/tests/unit/lib/auth/public-routes.test.ts
git commit -m "test(api): every station route is gated and provider-agnostic"
```

---

### Task 12: OpenAPI document, spec version, docs in production

**Files:**
- Create: `apps/web/src/lib/openapi/station-schemas.ts`
- Modify: `apps/web/src/lib/openapi/document.ts`
- Modify: `apps/web/src/lib/openapi/versions.ts:28-30`
- Modify: `apps/web/src/lib/openapi/docs-enabled.ts`
- Modify tests: `apps/web/tests/unit/lib/openapi/document.test.ts`, `docs-enabled.test.ts`, `apps/web/tests/unit/app/api/v1/openapi.json/route.test.ts`, `apps/web/tests/unit/app/api-docs/route.test.ts`, `apps/web/tests/unit/app/reference/route.test.ts`

- [ ] **Step 1: Write the failing document test** — append inside the `describe` in `document.test.ts`:

```ts
  it('documents the key-authenticated station API in v1', () => {
    const doc = buildOpenApiDocument('v1')
    expect(API_VERSION_META.v1.specVersion).toBe('1.1.0')
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(Object.keys(doc.paths ?? {})).toEqual(
      expect.arrayContaining([
        '/stations',
        '/stations/{stationId}',
        '/stations/{stationId}/readings',
        '/stations/{stationId}/readings/latest',
        '/stations/{stationId}/readings/aggregate',
      ]),
    )
    expect(doc.paths?.['/stations/{stationId}']?.patch).toBeDefined()
    expect(doc.paths?.['/stations']?.get?.security).toEqual([{ bearerAuth: [] }])
  })
```

- [ ] **Step 2: Rewrite the docs-enabled tests** — replace the body of `describe('areDocsEnabled', …)` in `docs-enabled.test.ts` with:

```ts
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  // On in production since the public station API (spec 2026-10-01): users
  // writing scripts need the reference.
  it.each([
    ['locally', undefined],
    ['in preview', 'preview'],
    ['in production', 'production'],
  ])('is enabled %s by default', (_label, vercelEnv) => {
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = vercelEnv
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('is disabled by API_DOCS_ENABLED=false', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'false'
    expect(areDocsEnabled()).toBe(false)
  })

  it('ignores values other than "false"', () => {
    process.env.API_DOCS_ENABLED = 'nope'
    expect(areDocsEnabled()).toBe(true)
  })
```

In each of the three route tests (`openapi.json/route.test.ts`, `api-docs/route.test.ts`, `reference/route.test.ts`), the "404 in production" case must now switch docs off explicitly. Replace

```ts
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
```

inside that case with

```ts
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'false'
```

and rename the case to `'returns 404 when docs are disabled'` (api-docs: `'returns 404 when docs are disabled rather than redirecting to a 404'`).

- [ ] **Step 3: Run them to see them fail**

Run: `yarn workspace @ws/web test:unit -- openapi docs-enabled api-docs reference`
Expected: FAIL — the new document test (no `/stations`) and the docs-enabled production case

- [ ] **Step 4: Docs on by default**

```ts
// apps/web/src/lib/openapi/docs-enabled.ts
/**
 * API docs (OpenAPI JSON + Scalar reference) are served everywhere, production
 * included: the key-authenticated station API is for users' own scripts, and
 * they need the reference (spec 2026-10-01). Nothing secret is documented —
 * the ingest entry describes the signing scheme, never a key.
 * `API_DOCS_ENABLED=false` turns them off; any other value leaves them on.
 */
export const areDocsEnabled = (): boolean =>
  process.env.API_DOCS_ENABLED !== 'false'
```

- [ ] **Step 5: Bump the spec version** — in `apps/web/src/lib/openapi/versions.ts`:

```ts
export const API_VERSION_META: Record<ApiVersion, ApiVersionMeta> = {
  // 1.1.0: key-authenticated station API (additive — /api/v1 unchanged).
  v1: { specVersion: '1.1.0', status: 'current' },
}
```

- [ ] **Step 6: Response schemas typed against the shared DTOs**

```ts
// apps/web/src/lib/openapi/station-schemas.ts
import type { ApiErrorBody, ApiReading, ApiStation } from '@ws/shared'
import { z } from 'zod'

import type { BucketedRow } from '@/lib/chart'

/**
 * Documentation schemas for the station API. Each is annotated with the type
 * the route actually returns, so the docs cannot drift from the contract
 * without a type error.
 */
export const stationDocSchema: z.ZodType<ApiStation> = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  address: z.string().nullable(),
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .nullable(),
  role: z.enum(['owner', 'editor', 'viewer']),
  status: z.enum(['unregistered', 'registered']),
  addedAt: z.string(),
  createdAt: z.string(),
  lastReadingAt: z.string().nullable(),
})

export const readingDocSchema: z.ZodType<ApiReading> = z.object({
  timestamp: z.string(),
  temperature: z.number(),
  humidity: z.number().nullable(),
  pressure: z.number(),
  windSpeed: z.number().nullable(),
  windDirection: z.number().nullable(),
  precipitation: z.number().nullable(),
})

const n = z.number().nullable()

export const bucketDocSchema: z.ZodType<BucketedRow> = z.object({
  bucket: z.string(),
  avgTemperature: n,
  minTemperature: n,
  maxTemperature: n,
  avgHumidity: n,
  minHumidity: n,
  maxHumidity: n,
  avgPressure: n,
  minPressure: n,
  maxPressure: n,
  avgWindSpeed: n,
  maxWindSpeed: n,
  totalPrecipitation: n,
  sampleCount: z.number().int(),
})

export const apiErrorDocSchema: z.ZodType<ApiErrorBody> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string()).optional(),
  }),
})
```

- [ ] **Step 7: Register the operations** — in `apps/web/src/lib/openapi/document.ts`:

Add imports below the existing ones:

```ts
import { API_AGGREGATE_INTERVALS } from '@ws/shared'

import {
  aggregateQuerySchema,
  readingsQuerySchema,
  stationPatchSchema,
} from '@/lib/api/schemas'
import {
  apiErrorDocSchema,
  bucketDocSchema,
  readingDocSchema,
  stationDocSchema,
} from '@/lib/openapi/station-schemas'
```

(merge `API_AGGREGATE_INTERVALS` into the existing `@ws/shared` value import rather than adding a second one).

Add above `registerV1Paths`:

```ts
const API_KEY_DESCRIPTION = [
  'Personal API key from Settings → API keys, sent as `Authorization: Bearer <key>`.',
  'Read keys may call every GET; PATCH needs a read & write key.',
  '60 requests per minute per key (RateLimit-* headers; 429 with Retry-After when exceeded).',
].join(' ')

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid query or body (`INVALID_INPUT`, with `fieldErrors`)',
  401: 'Missing, unknown, revoked or expired API key',
  403: 'Read-only key on a write (`INSUFFICIENT_SCOPE`), or a role without the authority (`FORBIDDEN`)',
  404: 'Station does not exist, or you are not a member of it',
  429: 'Rate limit exceeded for this key',
}
```

Append at the end of `registerV1Paths` (after the `/health` registration — additive, allowed with the `1.1.0` bump):

```ts
  // Key-authenticated station API (spec 2026-10-01, specVersion 1.1.0).
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    description: API_KEY_DESCRIPTION,
  })
  const Station = registry.register('Station', stationDocSchema)
  const Reading = registry.register('Reading', readingDocSchema)
  const ReadingBucket = registry.register('ReadingBucket', bucketDocSchema)
  const ApiError = registry.register('ApiError', apiErrorDocSchema)

  const security = [{ bearerAuth: [] }]
  const params = z.object({
    stationId: z.string().openapi({ example: 'ws-abc123def456' }),
  })
  const json = (schema: z.ZodTypeAny) => ({
    'application/json': { schema },
  })
  const errors = (...statuses: number[]) =>
    Object.fromEntries(
      statuses.map((status) => [
        status,
        {
          description: ERROR_DESCRIPTIONS[status] ?? 'Error',
          content: json(ApiError),
        },
      ]),
    )

  registry.registerPath({
    method: 'get',
    path: '/stations',
    summary: 'List your stations',
    description: 'Every station you own or that was shared with you.',
    security,
    responses: {
      200: {
        description: 'Your stations',
        content: json(z.object({ data: z.array(Station) })),
      },
      ...errors(401, 429),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/stations/{stationId}',
    summary: 'Get one station',
    security,
    request: { params },
    responses: {
      200: { description: 'The station', content: json(z.object({ data: Station })) },
      ...errors(401, 404, 429),
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/stations/{stationId}',
    summary: 'Edit station details',
    description:
      'Owners and editors only, with a read & write key. Omitted fields keep their value; null clears. Latitude and longitude are set or cleared together. Not callable from browsers (no CORS).',
    security,
    request: { params, body: { content: json(stationPatchSchema) } },
    responses: {
      200: {
        description: 'The station as stored',
        content: json(z.object({ data: Station })),
      },
      ...errors(400, 401, 403, 404, 429),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/stations/{stationId}/readings/latest',
    summary: 'Latest reading',
    security,
    request: { params },
    responses: {
      200: {
        description: 'The most recent reading, or null if the station never reported',
        content: json(z.object({ data: Reading.nullable() })),
      },
      ...errors(401, 404, 429),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/stations/{stationId}/readings',
    summary: 'Raw readings (paginated)',
    description:
      'Ascending by time. Default window: the last 24 h; at most 31 days per request. When `nextCursor` is set, pass it back as `cursor` with the same from/to for the next page.',
    security,
    request: { params, query: readingsQuerySchema },
    responses: {
      200: {
        description: 'One page of readings',
        content: json(
          z.object({ data: z.array(Reading), nextCursor: z.string().nullable() }),
        ),
      },
      ...errors(400, 401, 404, 429),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/stations/{stationId}/readings/aggregate',
    summary: 'Aggregated readings',
    description:
      'min/avg/max per bucket. Default: hourly over the last 7 days. At most 1000 buckets and 366 days per request.',
    security,
    request: { params, query: aggregateQuerySchema },
    responses: {
      200: {
        description: 'Buckets in ascending order',
        content: json(
          z.object({
            data: z.array(ReadingBucket),
            interval: z.enum(API_AGGREGATE_INTERVALS),
          }),
        ),
      },
      ...errors(400, 401, 404, 429),
    },
  })
```

In `buildOpenApiDocument`, change `title: 'Weather Station Ingest API'` to `title: 'Weather Station API'`.

- [ ] **Step 8: Run the tests**

Run: `yarn workspace @ws/web test:unit -- openapi docs-enabled api-docs reference versions`
Expected: PASS

- [ ] **Step 9: Commit** (ask first)

```bash
git add apps/web/src/lib/openapi apps/web/tests/unit/lib/openapi apps/web/tests/unit/app/api/v1/openapi.json apps/web/tests/unit/app/api-docs apps/web/tests/unit/app/reference
git commit -m "feat(api): document the station API (v1 spec 1.1.0); docs on in production"
```

---

### Task 13: Server actions for managing keys

**Files:**
- Create: `apps/web/src/actions/api-keys.action.ts`
- Test: `apps/web/tests/unit/actions/api-keys.action.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/actions/api-keys.action.test.ts
import type {
  ApiKeyProvider,
  ApiKeySummary,
} from '@/lib/api/keys/provider'

const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const ensure = jest.fn()
jest.mock('@/actions/users.action', () => ({
  ensureCurrentUserAction: () => ensure(),
}))
const resolveUser = jest.fn<Promise<string | null>, [unknown, string]>()
jest.mock('@/actions/_helpers', () => ({
  resolveCurrentUserId: (s: unknown, c: string) => resolveUser(s, c),
}))
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const provider = {
  authenticate: jest.fn(),
  create: jest.fn(),
  list: jest.fn(),
  countActive: jest.fn(),
  revoke: jest.fn(),
} satisfies Record<keyof ApiKeyProvider, jest.Mock>
jest.mock('@/lib/api/keys', () => ({ getApiKeyProvider: () => provider }))
const deleteBucket = jest.fn<Promise<void>, [unknown, { bucket: string }]>()
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
  deleteRateLimitBucket: (s: unknown, p: { bucket: string }) =>
    deleteBucket(s, p),
}))

import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from '@/actions/api-keys.action'

const OWNER = { userId: 'u1', clerkUserId: 'user_1' }
const SUMMARY: ApiKeySummary = {
  id: 'k1',
  name: 'Grafana',
  scope: 'read',
  hint: 'a9Xk',
  createdAt: 't',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ userId: 'user_1' })
  ensure.mockResolvedValue({ ok: true, data: { userId: 'u1' } })
  resolveUser.mockResolvedValue('u1')
  provider.countActive.mockResolvedValue(0)
  provider.create.mockResolvedValue({ key: SUMMARY, secret: 'wsk_live_x' })
  provider.list.mockResolvedValue([SUMMARY])
  provider.revoke.mockResolvedValue(true)
  deleteBucket.mockResolvedValue(undefined)
})

describe('createApiKeyAction', () => {
  const input = { name: ' Grafana ', scope: 'read' as const, expiresInDays: 90 }

  it('requires a session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED',
    })
    expect(provider.create).not.toHaveBeenCalled()
  })

  it('creates through the provider and returns the secret once', async () => {
    await expect(createApiKeyAction(input)).resolves.toEqual({
      ok: true,
      data: { key: SUMMARY, secret: 'wsk_live_x' },
    })
    expect(provider.create).toHaveBeenCalledWith(OWNER, {
      name: 'Grafana',
      scope: 'read',
      expiresInDays: 90,
    })
  })

  it.each([
    ['empty name', { ...input, name: '  ' }, 'name'],
    ['unknown scope', { ...input, scope: 'admin' as never }, 'scope'],
    ['unoffered expiry', { ...input, expiresInDays: 7 }, 'expiresInDays'],
  ])('rejects %s', async (_label, bad, field) => {
    const res = await createApiKeyAction(bad)
    expect(res).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(!res.ok && res.fieldErrors?.[field]).toBeTruthy()
  })

  it('accepts a key that never expires', async () => {
    await createApiKeyAction({ ...input, expiresInDays: null })
    expect(provider.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ expiresInDays: null }),
    )
  })

  it('refuses an eleventh active key', async () => {
    provider.countActive.mockResolvedValue(10)
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'KEY_LIMIT',
    })
    expect(provider.create).not.toHaveBeenCalled()
  })

  it('maps a provider failure to UNKNOWN', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    provider.create.mockRejectedValue(new Error('db down'))
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'UNKNOWN',
    })
    log.mockRestore()
  })
})

describe('listApiKeysAction', () => {
  it('lists the caller’s keys', async () => {
    await expect(listApiKeysAction()).resolves.toEqual({
      ok: true,
      data: [SUMMARY],
    })
    expect(provider.list).toHaveBeenCalledWith(OWNER)
  })

  it('returns an empty list for a user without a users row', async () => {
    resolveUser.mockResolvedValue(null)
    await expect(listApiKeysAction()).resolves.toEqual({ ok: true, data: [] })
    expect(provider.list).not.toHaveBeenCalled()
  })
})

describe('revokeApiKeyAction', () => {
  it('revokes the caller’s key', async () => {
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(provider.revoke).toHaveBeenCalledWith(OWNER, 'k1')
    expect(deleteBucket).toHaveBeenCalledWith(
      { __brand: 'service' },
      { bucket: 'key:k1' },
    )
  })

  // The key is already revoked at this point; a limiter hiccup must not turn
  // that into a reported failure (a retry would then say "not found").
  it('still reports success when the bucket cleanup fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    deleteBucket.mockRejectedValue(new Error('db down'))
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('answers NOT_FOUND when the provider revoked nothing', async () => {
    provider.revoke.mockResolvedValue(false)
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(deleteBucket).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- api-keys.action`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// apps/web/src/actions/api-keys.action.ts
'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import type { ApiKeyScope } from '@ws/shared'
import {
  API_KEY_EXPIRY_DAYS,
  API_KEY_MAX_ACTIVE,
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_SCOPES,
} from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId } from './_helpers'
import { ensureCurrentUserAction } from './users.action'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { getApiKeyProvider } from '@/lib/api/keys'
import type { ApiKeyOwner, ApiKeySummary } from '@/lib/api/keys/provider'
import {
  apiKeyRateLimitBucket,
  deleteRateLimitBucket,
} from '@/services/api-keys/rate-limit.service'

// Server actions because creating a key mints a secret (CLAUDE.md: secrets
// and elevation go through the server path). Everything below talks to
// getApiKeyProvider(), never to a concrete provider (spec §5.1).

const EXPIRY_DAYS: readonly number[] = API_KEY_EXPIRY_DAYS

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name')
    .max(
      API_KEY_NAME_MAX_LENGTH,
      `Keep the name under ${API_KEY_NAME_MAX_LENGTH} characters`,
    ),
  scope: z.enum(API_KEY_SCOPES),
  expiresInDays: z
    .number()
    .refine((d) => EXPIRY_DAYS.includes(d), 'Pick one of the offered options')
    .nullable(),
})

const revokeSchema = z.object({ keyId: z.string().min(1).max(100) })

const UNKNOWN_MSG = 'Something went wrong. Try again.'

/** null when ensureCurrentUserAction never ran — no users row means no keys. */
const resolveOwner = async (
  clerkUserId: string,
): Promise<ApiKeyOwner | null> => {
  const userId = await resolveCurrentUserId(
    createServiceRoleClient(),
    clerkUserId,
  )
  return userId ? { userId, clerkUserId } : null
}

export const createApiKeyAction = async (input: {
  name: string
  scope: ApiKeyScope
  expiresInDays: number | null
}): Promise<ActionResult<{ key: ApiKeySummary; secret: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? 'name')] ??= issue.message
    }
    return actionError('INVALID_INPUT', 'Check the highlighted fields', fieldErrors)
  }

  const ensured = await ensureCurrentUserAction()
  if (!ensured.ok) return actionError(ensured.code, ensured.message)
  const owner: ApiKeyOwner = { userId: ensured.data.userId, clerkUserId }

  try {
    const provider = getApiKeyProvider()
    // Two concurrent creates can both pass this and land on 11; the cap keeps
    // the list sane, it is not a security boundary, so that race is accepted.
    if ((await provider.countActive(owner)) >= API_KEY_MAX_ACTIVE) {
      return actionError(
        'KEY_LIMIT',
        `You can have up to ${API_KEY_MAX_ACTIVE} active keys. Revoke one first.`,
      )
    }
    return actionOk(await provider.create(owner, parsed.data))
  } catch (err) {
    console.error('createApiKeyAction failed', err)
    return actionError('UNKNOWN', 'Could not create the key. Try again.')
  }
}

export const listApiKeysAction = async (): Promise<
  ActionResult<ApiKeySummary[]>
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  try {
    const owner = await resolveOwner(clerkUserId)
    return actionOk(owner ? await getApiKeyProvider().list(owner) : [])
  } catch (err) {
    console.error('listApiKeysAction failed', err)
    return actionError('UNKNOWN', UNKNOWN_MSG)
  }
}

export const revokeApiKeyAction = async (input: {
  keyId: string
}): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown key')
  try {
    const owner = await resolveOwner(clerkUserId)
    const revoked = owner
      ? await getApiKeyProvider().revoke(owner, parsed.data.keyId)
      : false
    if (!revoked) return actionError('NOT_FOUND', 'That key no longer exists')
  } catch (err) {
    console.error('revokeApiKeyAction failed', err)
    return actionError('UNKNOWN', UNKNOWN_MSG)
  }
  // Best-effort, and here rather than in the provider: providers know nothing
  // about the limiter (spec §3.2). The key is already revoked, so a failure is
  // logged, never reported — a retry would otherwise answer "not found".
  try {
    await deleteRateLimitBucket(createServiceRoleClient(), {
      bucket: apiKeyRateLimitBucket(parsed.data.keyId),
    })
  } catch (err) {
    console.error('revokeApiKeyAction: rate-limit bucket cleanup failed', err)
  }
  return actionOk(null)
}
```

- [ ] **Step 4: Run the test**

Run: `yarn workspace @ws/web test:unit -- api-keys.action`
Expected: PASS

- [ ] **Step 5: Commit** (ask first)

```bash
git add apps/web/src/actions/api-keys.action.ts apps/web/tests/unit/actions/api-keys.action.test.ts
git commit -m "feat(api): server actions to create, list and revoke API keys"
```

---

### Task 14: Settings — hooks and the API keys card

**Files:**
- Create: `apps/web/src/services/api-keys/api-keys.queries.ts`
- Create: `apps/web/src/components/settings/ApiKeysCard.tsx`
- Modify: `apps/web/src/app/(app)/settings/page.tsx`
- Test: `apps/web/tests/unit/components/settings/ApiKeysCard.test.tsx`

- [ ] **Step 1: Write the failing component test**

```tsx
// apps/web/tests/unit/components/settings/ApiKeysCard.test.tsx
/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import type { ApiKeySummary } from '@/lib/api/keys/provider'

const clerk = { isLoaded: true, isSignedIn: true }
jest.mock('@clerk/nextjs', () => ({ useUser: () => clerk }))
const list = jest.fn<Promise<unknown>, []>()
const create = jest.fn<Promise<unknown>, [unknown]>()
const revoke = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/api-keys.action', () => ({
  listApiKeysAction: () => list(),
  createApiKeyAction: (i: unknown) => create(i),
  revokeApiKeyAction: (i: unknown) => revoke(i),
}))

import { ApiKeysCard } from '@/components/settings/ApiKeysCard'

const key = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: 'k1',
  name: 'Grafana',
  scope: 'read',
  hint: 'a9Xk',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  ...over,
})

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )

beforeEach(() => {
  jest.clearAllMocks()
  clerk.isLoaded = true
  list.mockResolvedValue({ ok: true, data: [key()] })
})

describe('ApiKeysCard', () => {
  it('shows a skeleton until Clerk has loaded', () => {
    clerk.isLoaded = false
    wrap(<ApiKeysCard testId="keys" />)
    expect(screen.getByTestId('keys-skeleton')).toBeInTheDocument()
  })

  it('lists keys by name and hint, never a full secret', async () => {
    list.mockResolvedValue({
      ok: true,
      data: [key(), key({ id: 'k2', name: 'Old', revokedAt: '2026-09-02T00:00:00Z' })],
    })
    wrap(<ApiKeysCard testId="keys" />)
    expect(await screen.findByText('Grafana')).toBeInTheDocument()
    expect(screen.getByTestId('keys-key-k1-hint')).toHaveTextContent('…a9Xk')
    expect(screen.getByTestId('keys-key-k2-status')).toHaveTextContent('Revoked')
  })

  it('creates a key with the defaults and reveals the secret once', async () => {
    create.mockResolvedValue({
      ok: true,
      data: { key: key({ id: 'k3' }), secret: 'wsk_live_SECRET' },
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.type(screen.getByTestId('keys-name-input'), 'Home Assistant')
    await userEvent.click(screen.getByTestId('keys-submit'))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: 'Home Assistant',
        scope: 'read',
        expiresInDays: 90,
      }),
    )
    expect(await screen.findByTestId('keys-secret-value')).toHaveTextContent(
      'wsk_live_SECRET',
    )
  })

  it('shows field errors from the action', async () => {
    create.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Check the highlighted fields',
      fieldErrors: { name: 'Give the key a name' },
    })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-create'))
    await userEvent.click(screen.getByTestId('keys-submit'))
    expect(await screen.findByText('Give the key a name')).toBeInTheDocument()
  })

  it('disables creation at the active-key cap', async () => {
    list.mockResolvedValue({
      ok: true,
      data: Array.from({ length: 10 }, (_, i) => key({ id: `k${i}` })),
    })
    wrap(<ApiKeysCard testId="keys" />)
    await waitFor(() => expect(screen.getByTestId('keys-create')).toBeDisabled())
  })

  it('revokes after a confirmation click', async () => {
    revoke.mockResolvedValue({ ok: true, data: null })
    wrap(<ApiKeysCard testId="keys" />)
    await userEvent.click(await screen.findByTestId('keys-key-k1-revoke'))
    expect(revoke).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('keys-key-k1-confirm'))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith({ keyId: 'k1' }))
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `yarn workspace @ws/web test:unit -- ApiKeysCard`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the hooks**

```ts
// apps/web/src/services/api-keys/api-keys.queries.ts
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKeyScope } from '@ws/shared'

import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from '@/actions/api-keys.action'
import { unwrapAction } from '@/lib/actions/unwrap'

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
}

/** Server path: keys live behind the service role (no client grant on api_keys). */
export const useApiKeysQuery = (enabled: boolean) =>
  useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: async () => unwrapAction(await listApiKeysAction()),
    enabled,
  })

export const useCreateApiKeyMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      scope: ApiKeyScope
      expiresInDays: number | null
    }) => unwrapAction(await createApiKeyAction(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  })
}

export const useRevokeApiKeyMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { keyId: string }) =>
      unwrapAction(await revokeApiKeyAction(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  })
}
```

- [ ] **Step 4: Implement the card**

```tsx
// apps/web/src/components/settings/ApiKeysCard.tsx
'use client'

import { useUser } from '@clerk/nextjs'
import type { ApiKeyExpiryDays, ApiKeyScope } from '@ws/shared'
import {
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_EXPIRY_DAYS,
  API_KEY_MAX_ACTIVE,
} from '@ws/shared'
import Link from 'next/link'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { CopyButton } from '@/components/ui/CopyButton'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { ActionError } from '@/lib/actions/unwrap'
import type { ApiKeySummary } from '@/lib/api/keys/provider'
import { formatDateTime } from '@/lib/format'
import {
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
} from '@/services/api-keys/api-keys.queries'

type ExpiryChoice = `${ApiKeyExpiryDays}` | 'never'
type KeyStatus = 'active' | 'revoked' | 'expired'

const SCOPE_OPTIONS: { value: ApiKeyScope; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'read_write', label: 'Read & write' },
]
const EXPIRY_OPTIONS: { value: ExpiryChoice; label: string }[] = [
  ...API_KEY_EXPIRY_DAYS.map((days) => ({
    value: `${days}` as ExpiryChoice,
    label: `${days} days`,
  })),
  { value: 'never', label: 'Never' },
]
const DEFAULT_EXPIRY: ExpiryChoice = `${API_KEY_DEFAULT_EXPIRY_DAYS}`
const STATUS_LABEL: Record<KeyStatus, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
}

const toExpiresInDays = (choice: ExpiryChoice): number | null =>
  choice === 'never' ? null : Number(choice)

const keyStatus = (key: ApiKeySummary, now: number): KeyStatus => {
  if (key.revokedAt) return 'revoked'
  if (key.expiresAt && Date.parse(key.expiresAt) <= now) return 'expired'
  return 'active'
}

const ApiKeyRow = ({
  apiKey,
  testId,
}: {
  apiKey: ApiKeySummary
  testId: string
}): ReactElement => {
  const revoke = useRevokeApiKeyMutation()
  const [confirming, setConfirming] = useState(false)
  const status = useMemo(() => keyStatus(apiKey, Date.now()), [apiKey])
  const meta = useMemo(
    () =>
      [
        `Created ${formatDateTime(apiKey.createdAt)}`,
        `last used ${apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'never'}`,
        `expires ${apiKey.expiresAt ? formatDateTime(apiKey.expiresAt) : 'never'}`,
      ].join(' · '),
    [apiKey],
  )

  const askConfirm = useCallback(() => setConfirming(true), [])
  const cancel = useCallback(() => setConfirming(false), [])
  const confirm = useCallback(
    () => revoke.mutate({ keyId: apiKey.id }),
    [apiKey.id, revoke],
  )

  return (
    <li
      data-testid={testId}
      className="border-line flex flex-col gap-1 border-b py-3 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid={`${testId}-name`} className="font-medium">
          {apiKey.name}
        </span>
        <Badge testId={`${testId}-scope`}>
          {apiKey.scope === 'read' ? 'Read' : 'Read & write'}
        </Badge>
        <Badge
          testId={`${testId}-status`}
          tone={status === 'active' ? 'neutral' : 'muted'}
        >
          {STATUS_LABEL[status]}
        </Badge>
        <code
          data-testid={`${testId}-hint`}
          className="text-slate ml-auto font-mono text-xs"
        >
          {apiKey.hint ? `…${apiKey.hint}` : null}
        </code>
      </div>
      <p data-testid={`${testId}-meta`} className="text-slate text-xs">
        {meta}
      </p>
      {status === 'active' ? (
        <div className="flex gap-2">
          {confirming ? (
            <>
              <Button
                testId={`${testId}-confirm`}
                variant="danger"
                size="sm"
                loading={revoke.isPending}
                onClick={confirm}
              >
                Revoke now
              </Button>
              <Button
                testId={`${testId}-cancel`}
                variant="ghost"
                size="sm"
                onClick={cancel}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              testId={`${testId}-revoke`}
              variant="ghost"
              size="sm"
              onClick={askConfirm}
            >
              Revoke
            </Button>
          )}
        </div>
      ) : null}
      {revoke.error ? (
        <p data-testid={`${testId}-error`} className="text-danger text-xs">
          {revoke.error.message}
        </p>
      ) : null}
    </li>
  )
}

const ApiKeySecret = ({
  secret,
  testId,
  onDone,
}: {
  secret: string
  testId: string
  onDone: () => void
}): ReactElement => {
  const curl = useMemo(
    () =>
      `curl -H "Authorization: Bearer ${secret}" ${window.location.origin}/api/v1/stations`,
    [secret],
  )
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <code
          data-testid={`${testId}-value`}
          className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all select-all"
        >
          {secret}
        </code>
        <CopyButton
          testId={`${testId}-copy`}
          value={secret}
          label="Copy key"
          copiedLabel="Key copied"
        />
      </div>
      <p className="text-danger text-[13px] font-medium">
        Shown once. Store it now — it cannot be shown again, only revoked.
      </p>
      <div className="flex items-start gap-2">
        <code
          data-testid={`${testId}-curl`}
          className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all"
        >
          {curl}
        </code>
        <CopyButton
          testId={`${testId}-copy-curl`}
          value={curl}
          label="Copy"
          copiedLabel="Copied"
        />
      </div>
      <div className="flex justify-end">
        <Button testId={`${testId}-done`} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

export const ApiKeysCard = ({ testId }: { testId: string }): ReactElement => {
  const { isLoaded, isSignedIn } = useUser()
  const keys = useApiKeysQuery(!!isSignedIn)
  const create = useCreateApiKeyMutation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [expiry, setExpiry] = useState<ExpiryChoice>(DEFAULT_EXPIRY)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [secret, setSecret] = useState<string | null>(null)

  const activeCount = useMemo(() => {
    const now = Date.now()
    return (keys.data ?? []).filter((k) => keyStatus(k, now) === 'active')
      .length
  }, [keys.data])
  const atCap = activeCount >= API_KEY_MAX_ACTIVE

  const rows = useMemo(
    () =>
      (keys.data ?? []).map((apiKey) => (
        <ApiKeyRow
          key={apiKey.id}
          apiKey={apiKey}
          testId={`${testId}-key-${apiKey.id}`}
        />
      )),
    [keys.data, testId],
  )

  const openDialog = useCallback(() => {
    setName('')
    setScope('read')
    setExpiry(DEFAULT_EXPIRY)
    setErrors({})
    setSecret(null)
    setOpen(true)
  }, [])
  const onOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    // The secret lives only in this state; closing the dialog drops it.
    if (!next) setSecret(null)
  }, [])
  const closeDialog = useCallback(() => onOpenChange(false), [onOpenChange])
  const onName = useCallback(
    (e: FormEvent<HTMLInputElement>) => setName(e.currentTarget.value),
    [],
  )
  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setErrors({})
      try {
        const created = await create.mutateAsync({
          name,
          scope,
          expiresInDays: toExpiresInDays(expiry),
        })
        setSecret(created.secret)
      } catch (err) {
        setErrors(
          err instanceof ActionError
            ? (err.fieldErrors ?? { form: err.message })
            : { form: 'Could not create the key. Try again.' },
        )
      }
    },
    [create, expiry, name, scope],
  )

  if (!isLoaded || keys.isLoading) {
    return (
      <Card testId={testId}>
        <CardBody testId={`${testId}-body`}>
          <Skeleton testId={`${testId}-skeleton`} className="h-24 w-full" />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>API keys</CardTitle>
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <p className="text-slate mb-2 text-sm">
          Read your stations from your own scripts (Grafana, Home Assistant,
          curl). See the{' '}
          <Link
            data-testid={`${testId}-docs`}
            href="/reference"
            className="underline"
          >
            API reference
          </Link>
          .
        </p>
        <p
          data-testid={`${testId}-warning`}
          className="text-slate mb-3 text-xs"
        >
          A key placed in a website&apos;s JavaScript is public. Use a Read key
          there, and remember it shows the address and coordinates of every
          station you can see — calling the API from your own server is safer.
        </p>
        {rows.length > 0 ? (
          <ul data-testid={`${testId}-list`} className="mb-3">
            {rows}
          </ul>
        ) : (
          <p data-testid={`${testId}-empty`} className="text-slate mb-3 text-sm">
            No keys yet.
          </p>
        )}
        <Button
          testId={`${testId}-create`}
          size="sm"
          onClick={openDialog}
          disabled={atCap}
        >
          Create key
        </Button>
        {atCap ? (
          <p data-testid={`${testId}-cap`} className="text-slate mt-2 text-xs">
            You have {API_KEY_MAX_ACTIVE} active keys. Revoke one to create
            another.
          </p>
        ) : null}
      </CardBody>
      <Dialog
        testId={`${testId}-dialog`}
        open={open}
        onOpenChange={onOpenChange}
        title={secret ? 'Copy your API key' : 'Create API key'}
        description={
          secret
            ? "You won't see this key again."
            : 'Scripts send it as Authorization: Bearer <key>.'
        }
      >
        {secret ? (
          <ApiKeySecret
            secret={secret}
            testId={`${testId}-secret`}
            onDone={closeDialog}
          />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <Field
              testId={`${testId}-name`}
              label="Name"
              htmlFor="api-key-name"
              error={errors.name}
            >
              <Input
                testId={`${testId}-name-input`}
                id="api-key-name"
                value={name}
                onChange={onName}
                invalid={!!errors.name}
                autoComplete="off"
              />
            </Field>
            <Field
              testId={`${testId}-scope`}
              label="Access"
              htmlFor="api-key-scope"
              error={errors.scope}
            >
              <Select
                testId={`${testId}-scope-select`}
                value={scope}
                onValueChange={setScope}
                options={SCOPE_OPTIONS}
                ariaLabel="Access"
              />
            </Field>
            <Field
              testId={`${testId}-expiry`}
              label="Expires"
              htmlFor="api-key-expiry"
              error={errors.expiresInDays}
            >
              <Select
                testId={`${testId}-expiry-select`}
                value={expiry}
                onValueChange={setExpiry}
                options={EXPIRY_OPTIONS}
                ariaLabel="Expires"
              />
            </Field>
            {errors.form ? (
              <p
                data-testid={`${testId}-form-error`}
                className="text-danger text-sm"
              >
                {errors.form}
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button
                testId={`${testId}-submit`}
                type="submit"
                loading={create.isPending}
              >
                Create key
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Card>
  )
}
```

- [ ] **Step 5: Add the card to Settings** — in `apps/web/src/app/(app)/settings/page.tsx` import it and render it between Telegram and Delete:

```tsx
import { ApiKeysCard } from '@/components/settings/ApiKeysCard'
```

```tsx
    <TelegramCard testId="settings-telegram" />
    <ApiKeysCard testId="settings-api-keys" />
    <DeleteAccountCard testId="settings-delete" />
```

- [ ] **Step 6: Run the test**

Run: `yarn workspace @ws/web test:unit -- ApiKeysCard`
Expected: PASS (6 tests)

- [ ] **Step 7: Review** — dispatch the `data-path-reviewer` agent on the changed `apps/web` files (actions, services, queries, card, routes); fix findings.

- [ ] **Step 8: Commit** (ask first)

```bash
git add apps/web/src/services/api-keys/api-keys.queries.ts apps/web/src/components/settings/ApiKeysCard.tsx "apps/web/src/app/(app)/settings/page.tsx" apps/web/tests/unit/components/settings/ApiKeysCard.test.tsx
git commit -m "feat(settings): API keys card — create, reveal once, revoke"
```

---

### Task 15: Documentation

**Files:**
- Modify: `docs/04-prd.md` (B3 row, Authentication row)
- Modify: `docs/privacy-data-minimisation.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: PRD** — replace the B3 row text with:

```markdown
| B3 | The backend does **not** serve read endpoints for sensor data **to the web app or the bot**: they query Supabase directly via their respective clients; RLS enforces data isolation at the database layer. Separately, a key-authenticated public API (`/api/v1/stations…`, amended 2026-10-01) serves users' **own scripts**: personal API keys created in Settings, read access to the stations the key's user is a member of, and station-detail edits for owners/editors with a read & write key. |
```

and append to the Authentication row: ` Public API: personal API key (bearer, hashed at rest, revocable, scoped read / read & write).`

- [ ] **Step 2: Privacy doc** — add a table row after the `devices` coordinates row:

```markdown
| `api_keys` | `user_id`, `name`, `key_hash`, `key_hint`, `scope`, timestamps | Personal API keys for the user's own scripts; only a SHA-256 of the key is stored | Until revoked-row cleanup or account deletion (cascade) | Required for the public API; opt-in |
```

and a paragraph after "Who sees whose identifiers":

```markdown
Public API: anyone holding a user's API key reads every station that user can
see, including nickname, address and coordinates. A key embedded in a
website's JavaScript is public; Settings warns about this and recommends a
read-only key or a server-side call. Keys are revocable instantly and never
reveal member identities.
```

- [ ] **Step 3: CLAUDE.md** — make these edits:

1. In "Architecture — Two Data Paths", after the SERVER PATH block, add:

```markdown
KEY PATH (RLS bypassed) ← only /api/v1/stations… (public API for users' scripts)
  Script → Bearer API key → withApiKey (provider → rate limit → scope)
         → requireStation (membership + @ws/shared predicate) → Service (service-role)
```

2. Add a section after "Device Ingest (API route — the other server path)":

```markdown
### Public station API (`/api/v1/stations…`)

Personal API keys for users' own scripts (spec
`docs/superpowers/specs/2026-10-01-public-read-api-design.md`).

- **Every route is `withApiKey(...)`**, and every `/stations/{id}` route calls
  `requireStation` before touching data — RLS is bypassed here.
  `tests/unit/app/api/v1/stations/registry.test.ts` walks the folder and fails
  on an ungated handler.
- **Keys live behind `ApiKeyProvider`**; `getApiKeyProvider()` in
  `lib/api/keys/index.ts` is the only switch point. Today: our hashed keys in
  `api_keys`. Clerk API keys can replace them (spec §11) — routes, limiter and
  UI do not change. Never import `own-provider` outside `lib/api/keys/`.
- **Never call `fetchMyDevices` on the service-role client** — it has no
  `WHERE` and returns every user's stations there. Use `fetchStationsForUser`
  / `fetchStationForUser`.
- Rate limit: `api_rate_limit_hit()` (60/min per key), buckets are opaque
  strings so the limiter is provider-independent.
- CORS: GET + OPTIONS only. PATCH has none on purpose — a write key must not
  live in browser JavaScript.
- `update_device_profile()` now has two callers: `updateDeviceProfileAction`
  and `writeDeviceProfile` (PATCH /stations/{id}).
```

3. In "Device roles", change "currently 1 shared + 4 web for narrowing `canEditDeviceProfile`" to "currently 1 shared + 5 web" and add `tests/unit/app/api/v1/stations/stations.route.test.ts` ("lets an editor write") to the parenthesised file list.

4. In the "Gate helpers" paragraph add: "`requireStation` (`lib/api/station-gate.ts`) is the public API's equivalent, taking the same predicates."

5. In the Environment Variables table change the `API_DOCS_ENABLED` description to: "Docs are on everywhere by default (the public API needs them); `false` turns `/reference` and `openapi.json` off".

- [ ] **Step 4: Format and commit** (ask first)

```bash
yarn format
git add docs/04-prd.md docs/privacy-data-minimisation.md CLAUDE.md
git commit -m "docs: amend PRD B3, privacy review and CLAUDE.md for the public station API"
```

---

### Task 16: Full verification

- [ ] **Step 1: Static checks**

Run: `yarn lint && yarn check-types && yarn format:check`
Expected: all clean. Fix any `eslint` complaint by refactoring — never `eslint-disable`.

- [ ] **Step 2: All test layers**

Run:
```bash
yarn test:unit
cd infra/supabase-db && yarn db-reset:local && yarn test:db && cd ../..
yarn workspace @ws/web test:integration:secrets
```
Expected: everything PASS.

- [ ] **Step 3: Build** (also type-checks the route handler signatures Next generates validators for)

Run: `yarn build`
Expected: success; the build output lists `ƒ /api/v1/stations`, `ƒ /api/v1/stations/[stationId]`, and the three readings routes.

- [ ] **Step 4: End-to-end by hand** — run `/verify` for the web area, or:

1. `infisical run -- yarn workspace @ws/web dev` and sign in at `http://localhost:3000/settings`.
2. Create a **Read** key and a **Read & write** key; copy both (`R`, `W`).
3. With a station you own (`<id>`) and one you were shared as viewer (`<vid>`), run:

```bash
B=http://localhost:3000/api/v1
curl -s -i $B/stations -H "Authorization: Bearer $R" | head -20          # 200, RateLimit-* headers, your stations only
curl -s $B/stations/<id>/readings/latest -H "Authorization: Bearer $R"   # {"data":{...}} or {"data":null}
curl -s "$B/stations/<id>/readings?limit=2" -H "Authorization: Bearer $R" # 2 rows + nextCursor
curl -s "$B/stations/<id>/readings/aggregate?interval=1d" -H "Authorization: Bearer $R"
curl -s -X PATCH $B/stations/<id> -H "Authorization: Bearer $R" -H 'content-type: application/json' -d '{"label":"Roof"}'   # 403 INSUFFICIENT_SCOPE
curl -s -X PATCH $B/stations/<id> -H "Authorization: Bearer $W" -H 'content-type: application/json' -d '{"label":"Roof"}'   # 200, label Roof
curl -s -X PATCH $B/stations/<vid> -H "Authorization: Bearer $W" -H 'content-type: application/json' -d '{"label":"X"}'      # 403 FORBIDDEN
curl -s $B/stations/ws-notyours000 -H "Authorization: Bearer $R"         # 404
curl -s -i $B/stations -H "Authorization: Bearer wsk_live_nope" | head -1 # 401 JSON — proves Clerk middleware passes the bearer through
for i in $(seq 1 61); do curl -s -o /dev/null -w "%{http_code}\n" $B/stations -H "Authorization: Bearer $R"; done | sort | uniq -c   # 60× 200 (minus earlier calls this minute), then 429
```

4. In the browser console on any other origin (e.g. `https://example.com`):

```js
await fetch('http://localhost:3000/api/v1/stations', { headers: { Authorization: 'Bearer <R>' } }).then(r => r.status)          // 200
await fetch('http://localhost:3000/api/v1/stations/<id>', { method: 'PATCH', headers: { Authorization: 'Bearer <W>', 'content-type': 'application/json' }, body: '{"label":"x"}' })  // CORS error
```

5. Revoke `R` in Settings, repeat the first curl → 401. Open `/reference` → the Station endpoints appear under v1 (1.1.0).

- [ ] **Step 5: Final review** — run the `rls-reviewer` (migration) and `data-path-reviewer` (web) agents once more on the whole branch diff; then use superpowers:requesting-code-review.

- [ ] **Step 6: Hand over** — use superpowers:finishing-a-development-branch (PR into `dev`). Ask before pushing.
