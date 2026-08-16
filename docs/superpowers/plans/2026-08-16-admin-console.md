# Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members of one Clerk organization provision and run the station fleet from `/admin` — create devices, rotate secrets, unclaim or delete devices, and inspect every device and user.

**Architecture:** One Clerk org id decides admin status. It lives in `process.env.ADMIN_ORG_ID` (read by the proxy and by every server action) and in a Supabase Vault secret `admin_org_id` (read by RLS through `public.is_admin_request()`). Reads run on the client path through permissive admin SELECT policies whose predicate references no row column, so Postgres evaluates them once per statement. Writes that mint or destroy run as server actions with the service-role client.

**Tech Stack:** Next.js 16 App Router (proxy, not middleware), React 19.2, TypeScript, Tailwind v4, TanStack Query 5, Clerk v7 Core 3 (organizations), Supabase/Postgres 17 with RLS + Vault 0.3.1, Jest 29 + jsdom, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-16-admin-console-design.md`

## Global Constraints

- **Never `any`** — including `as any`, `any[]`, `Record<string, any>`. Use `unknown` + narrowing.
- **Never `eslint-disable`** or any ESLint suppression comment. If lint complains, refactor.
- **Arrow functions only** (`func-style: ["error", "expression"]`); `const` over `let`.
- **`testId` prop on every component**, rendered as `data-testid`, kebab-case.
- **`import type` separated** from value imports; `ReactElement`/`ReactNode` via named import, never `JSX.Element`.
- **`useCallback` for every function defined in a component**; no inline anonymous functions in JSX. **`useMemo`** for derived values, mapped arrays, and object/array literals passed as props.
- **Tests never sit next to source** — `apps/web/tests/{unit,integration}/`, mirroring `src/`, imported via `@/`.
- **Services are pure async arrow functions** taking `supabase: SupabaseClient<Database>` first and throwing `ServiceError`.
- **Server actions** start with `'use server'`, have `import 'server-only'` as the first import, export only async functions, return `ActionResult`, and are consumed through TanStack hooks with `unwrapAction()`.
- **Column aliasing:** alias snake_case → camelCase inside `.select()`; filters and write payloads stay snake_case.
- **`devices.secret` is service-role only.** No migration in this plan may grant that column to any role. A secret reaches the browser only as the return value of `createDeviceAction` / `rotateDeviceSecretAction`.
- **Admin RLS predicates must reference no row column** — always `using ((select public.is_admin_request()))`. This is the per-request rule and Task 2 tests it with `EXPLAIN`.
- **No org id in git.** Migrations create functions only; the value is set per environment.
- **Migrations:** `yarn migrate:new <name>` from `infra/supabase-db/`; `yarn regenerate:types` after every migration.
- Run `yarn lint && yarn check-types && yarn test:unit` before calling any task done; `yarn format` before committing.

---

## File Structure

| File                                                                | Responsibility                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/shared/src/constants/index.ts`                            | `generateDeviceId()`, `generateDeviceSecret()` — one minting rule           |
| `infra/supabase-db/supabase/migrations/<ts>_admin_org_access.sql`   | `is_admin_request()` + admin SELECT policies on the five tables            |
| `infra/supabase-db/supabase/tests/admin_org_access.sql`             | pgTAP: helper properties, visibility matrix, InitPlan proof, secret hidden |
| `infra/supabase-db/scripts/set-admin-org.ts`                        | `yarn admin:set-org <org_id>` — writes the Vault secret                    |
| `apps/web/src/lib/admin/org.ts`                                     | `adminOrgId()` reader + `isAdminOrg(orgId)` — server-only                  |
| `apps/web/src/proxy.ts`                                             | Layer 1: `/admin(.*)` except `/admin/activate` requires the active org     |
| `apps/web/src/actions/admin.action.ts`                              | Status gate, create, rotate, unclaim, delete                               |
| `apps/web/src/services/admin/admin.service.ts`                      | Fleet reads (devices with owner counts + last reading, users with counts)  |
| `apps/web/src/services/admin/admin.queries.ts`                      | Query keys, read hooks, mutation hooks                                     |
| `apps/web/src/app/(app)/admin/layout.tsx`                           | Layer 2 gate + admin shell                                                 |
| `apps/web/src/app/(app)/admin/page.tsx`, `users/page.tsx`, `activate/page.tsx` | Routes                                                       |
| `apps/web/src/components/admin/*`                                   | `AdminDevicesTable`, `CreateDeviceDialog`, `SecretReveal`, `DeviceRowActions`, `AdminUsersTable`, `ConfigMismatchBanner`, `ActivateAdminOrg` |

---

### Task 1: Shared device minting + Vault script

**Files:**

- Modify: `packages/shared/src/constants/index.ts`
- Modify: `infra/supabase-db/scripts/provision-device.ts` (use the shared helpers)
- Create: `infra/supabase-db/scripts/set-admin-org.ts`
- Modify: `infra/supabase-db/package.json` (add `admin:set-org`)
- Test: `packages/shared/tests/unit/device-identity.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `generateDeviceId(): string` (`ws-` + 12 lowercase hex), `generateDeviceSecret(): string` (64 lowercase hex).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/tests/unit/device-identity.test.ts`:

```ts
import { generateDeviceId, generateDeviceSecret } from '../../src'

describe('device identity', () => {
  it('mints ids as ws- plus 12 lowercase hex characters', () => {
    const id = generateDeviceId()
    expect(id).toMatch(/^ws-[0-9a-f]{12}$/)
    expect(generateDeviceId()).not.toBe(id)
  })

  it('mints 256-bit secrets as 64 lowercase hex characters', () => {
    const secret = generateDeviceSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(generateDeviceSecret()).not.toBe(secret)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
yarn workspace @ws/shared test:unit -- device-identity
```

Expected: FAIL — `generateDeviceId` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/constants/index.ts`:

```ts
import { randomBytes } from 'node:crypto'

/**
 * Device identity is minted in exactly one place so the admin console and the
 * provisioning CLI cannot drift. `ws-` + 12 hex keeps the id short enough to
 * print on a label and type by hand; the secret is a 256-bit HMAC key.
 * Server-side only — both use node:crypto.
 */
export const generateDeviceId = (): string =>
  `ws-${randomBytes(6).toString('hex')}`

export const generateDeviceSecret = (): string =>
  randomBytes(32).toString('hex')
```

- [ ] **Step 4: Run the test**

```bash
yarn workspace @ws/shared test:unit -- device-identity
```

Expected: PASS.

- [ ] **Step 5: Point the CLI at the shared helpers**

In `infra/supabase-db/scripts/provision-device.ts`, delete the two local
generators and import the shared ones:

```ts
import { generateDeviceId, generateDeviceSecret } from '@ws/shared'
```

Replace the `makeDeviceId()` / `makeSecret()` call sites inside
`registerDevice()`:

```ts
    const deviceId = generateDeviceId()
    const secret = generateDeviceSecret()
```

Also remove the now-unused `randomUUID` from the `node:crypto` import (keep
`randomBytes` only if still referenced elsewhere in the file — at the time of
writing it is not, so the import line becomes
`import { execFileSync } from 'node:child_process'` plus the fs imports).

- [ ] **Step 6: Verify the CLI still provisions**

```bash
cd infra/supabase-db && infisical run -- yarn provision:device
```

Expected: prints `DEVICE_ID = ws-…` (12 hex) and `DEVICE_SECRET = …` (64 hex).
Delete the row afterwards so it does not pollute local data:

```bash
docker exec supabase_db_weather-station psql -U postgres -d postgres \
  -c "delete from public.devices where device_id = '<the printed id>';"
```

- [ ] **Step 7: Add the Vault script**

Create `infra/supabase-db/scripts/set-admin-org.ts`:

```ts
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env
const orgId = process.argv[2]

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')
}
if (!orgId?.startsWith('org_')) {
  throw new Error('Usage: yarn admin:set-org org_xxxxxxxxxxxxxxxx')
}

// Vault is only reachable with the service-role key. The secret name is what
// public.is_admin_request() looks up; changing it means changing that function.
const db = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY)

const { error } = await db.rpc('set_admin_org_id', { p_org_id: orgId })
if (error) throw new Error(error.message)

console.error(`admin_org_id set to ${orgId}`)
console.error(
  'Set ADMIN_ORG_ID to the same value in the app environment (Infisical / Vercel).',
)
```

Add to `infra/supabase-db/package.json` scripts, next to `provision:device`:

```json
    "admin:set-org": "node --env-file-if-exists=.env --experimental-strip-types scripts/set-admin-org.ts",
```

(The `set_admin_org_id` RPC it calls is created in Task 2 — the script is not
runnable until then, which the next task's steps cover.)

- [ ] **Step 8: Commit**

```bash
yarn format
git add packages/shared infra/supabase-db
git commit -m "feat(shared): single source for device id/secret minting; admin org vault script"
```

---

### Task 2: RLS — admin org bypass with the per-request guarantee

**Files:**

- Create: `infra/supabase-db/supabase/migrations/<timestamp>_admin_org_access.sql`
- Create: `infra/supabase-db/supabase/tests/admin_org_access.sql`
- Modify: `infra/supabase-db/src/types/database.ts` (regenerated)

**Interfaces:**

- Consumes: nothing from Task 1 at runtime (the script in Task 1 calls the RPC created here).
- Produces: `public.is_admin_request() → boolean`, `public.set_admin_org_id(p_org_id text) → void` (service-role only), and one permissive admin SELECT policy on each of `devices`, `device_users`, `readings`, `users`, `schedules`.

- [ ] **Step 1: Create the migration file**

```bash
cd infra/supabase-db && yarn migrate:new admin_org_access
```

Note the printed path; the next step writes into that file.

- [ ] **Step 2: Write the migration**

```sql
-- Admin console: members of one Clerk organization can read the whole fleet.
--
-- The org id is NOT stored here. It lives in Vault under 'admin_org_id' (set
-- per environment with `yarn admin:set-org`), so no environment's identifier
-- is committed and a missing secret fails closed.
--
-- HARD RULE: the predicate below takes no arguments and references no row
-- column, so Postgres evaluates it once per statement (InitPlan) rather than
-- once per row. Every policy wraps it as `(select public.is_admin_request())`.
-- The pgTAP suite proves this with EXPLAIN; a helper that took the row's
-- device_id would silently become a correlated SubPlan.
create or replace function public.is_admin_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id')
      = (auth.jwt() ->> 'org_id'),
    false
  );
$$;

revoke execute on function public.is_admin_request() from public, anon;
grant execute on function public.is_admin_request() to authenticated, service_role;

-- Writing the secret needs the service role; exposing it as an RPC keeps the
-- provisioning script free of raw vault SQL.
create or replace function public.set_admin_org_id(p_org_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'admin_org_id';
  if v_id is null then
    perform vault.create_secret(p_org_id, 'admin_org_id',
      'Clerk organization whose members are fleet admins');
  else
    perform vault.update_secret(v_id, p_org_id);
  end if;
end;
$$;

revoke execute on function public.set_admin_org_id(text) from public, anon, authenticated;
grant execute on function public.set_admin_org_id(text) to service_role;

-- Permissive policies: they OR with the existing per-user policies, so a
-- normal user's visibility is unchanged.
create policy "admin org can view all devices"
  on public.devices for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all device links"
  on public.device_users for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all readings"
  on public.readings for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all users"
  on public.users for select to authenticated
  using ((select public.is_admin_request()));

create policy "admin org can view all schedules"
  on public.schedules for select to authenticated
  using ((select public.is_admin_request()));

-- Deliberately NOT covered: telegram_link_codes. One-time link codes have no
-- admin use case and are the one table whose contents allow hijacking an
-- identity link.
--
-- Also deliberately absent: any grant on devices.secret. The admin bypass
-- grants row visibility only; the column-list grant from the init migration is
-- what keeps the HMAC key unreadable, and RLS cannot override it.
```

- [ ] **Step 3: Apply and regenerate types**

```bash
yarn migrate:up
yarn regenerate:types
grep -n "is_admin_request\|set_admin_org_id" src/types/database.ts
```

Expected: both functions appear under `Functions`.

- [ ] **Step 4: Set the local Vault secret**

```bash
infisical run -- yarn admin:set-org org_localdevadminorg000
docker exec supabase_db_weather-station psql -U postgres -d postgres \
  -Atc "select name, decrypted_secret from vault.decrypted_secrets where name='admin_org_id';"
```

Expected: `admin_org_id|org_localdevadminorg000`.

- [ ] **Step 5: Write the pgTAP suite**

Create `infra/supabase-db/supabase/tests/admin_org_access.sql`:

```sql
begin;
select plan(14);

-- The suite must not depend on the developer's real Vault value.
select public.set_admin_org_id('org_pgtap_admin');

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'user_admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'user_plain');
insert into public.devices (device_id, secret, status) values
  ('ws-admin0000001', 'topsecret', 'registered'),
  ('ws-other0000002', 'topsecret', 'registered');
insert into public.device_users (device_id, user_id, role) values
  ('ws-other0000002', '00000000-0000-0000-0000-0000000000a2', 'owner');
insert into public.readings (device_id, timestamp, temperature, humidity, pressure) values
  ('ws-admin0000001', '2026-08-01T00:00:00Z', 20, 50, 1000),
  ('ws-other0000002', '2026-08-01T00:00:00Z', 21, 51, 1001);
insert into public.schedules (user_id, time, timezone, days)
  values ('00000000-0000-0000-0000-0000000000a2', '07:30', 'UTC', array[1]);

-- helper properties
select ok((select prosecdef from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 'is_admin_request is SECURITY DEFINER');
select is((select provolatile from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 's', 'is_admin_request is STABLE');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.is_admin_request()'::regprocedure), 'is_admin_request pins an empty search_path');
select ok(not has_function_privilege('anon', 'public.is_admin_request()', 'execute'), 'anon cannot execute is_admin_request');
select ok(not has_function_privilege('authenticated', 'public.set_admin_org_id(text)', 'execute'), 'clients cannot write the admin org id');

set local role authenticated;

-- a normal user is unaffected: own rows only
select set_config('request.jwt.claims', '{"sub":"user_plain","role":"authenticated"}', true);
select is((select count(*) from public.devices), 1::bigint, 'non-admin still sees only their own device');
select is((select count(*) from public.users), 1::bigint, 'non-admin still sees only their own users row');
select ok((select public.is_admin_request()) = false, 'no org_id claim is not admin');

-- a session whose org_id is some other organisation is not admin
select set_config('request.jwt.claims', '{"sub":"user_plain","role":"authenticated","org_id":"org_someone_else"}', true);
select ok((select public.is_admin_request()) = false, 'a different org_id is not admin');

-- the admin org sees everything covered, and nothing that is not
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtap_admin"}', true);
select ok((select public.is_admin_request()), 'matching org_id is admin');
select is((select count(*) from public.devices), 2::bigint, 'admin sees every device');
select is((select count(*) from public.readings), 2::bigint, 'admin sees every reading');
select throws_ok(
  $$ select count(*) from public.telegram_link_codes $$,
  '42501', null, 'admin still cannot read telegram_link_codes'
);
select ok(not has_column_privilege('authenticated', 'public.devices', 'secret', 'select'), 'devices.secret is still ungranted');

select * from finish();
rollback;
```

- [ ] **Step 6: Run the DB suite**

```bash
yarn db-reset:local && yarn test:db
```

Expected: `Result: PASS`. A reset drops the Vault secret set in Step 4, so
re-run `infisical run -- yarn admin:set-org org_localdevadminorg000` afterwards
for the app to work locally.

- [ ] **Step 7: Prove the per-request rule with EXPLAIN**

Add this second suite, `infra/supabase-db/supabase/tests/admin_initplan.sql`:

```sql
begin;
select plan(2);

select public.set_admin_org_id('org_pgtap_admin');
insert into public.users (id, clerk_user_id) values ('00000000-0000-0000-0000-0000000000a1', 'user_admin');
insert into public.devices (device_id, secret, status) values
  ('ws-plan00000001', 's', 'registered'),
  ('ws-plan00000002', 's', 'registered'),
  ('ws-plan00000003', 's', 'registered');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_admin","role":"authenticated","org_id":"org_pgtap_admin"}', true);

-- The admin predicate must be hoisted to a single InitPlan. If someone changes
-- a policy to pass a row column into the helper it becomes a correlated
-- SubPlan evaluated once per row, and these assertions fail.
create temporary table plan_json as
  select query_plan::text as txt
  from (select jsonb_pretty(p) as query_plan
        from (select (plan_row->0) as p
              from (select (explain_output::jsonb) as plan_row
                    from (select string_agg(l, e'\n') as explain_output
                          from (explain (format json, costs off)
                                select device_id from public.devices) as e(l)
                         ) s
                   ) t
             ) u
      ) v;

select ok((select txt like '%InitPlan%' from plan_json), 'the admin predicate is an InitPlan (evaluated once per statement)');
select ok((select txt not like '%SubPlan%' from plan_json), 'the admin predicate is not a correlated SubPlan (per row)');

select * from finish();
rollback;
```

Run it:

```bash
yarn test:db
```

Expected: `Result: PASS` for both suites. If the EXPLAIN plumbing above fails to
parse on this Postgres build, simplify it to a single
`select ok((select string_agg(l, ' ') from (explain (costs off) select device_id from public.devices) as e(l)) like '%InitPlan%', '…')`
— the assertion that matters is the presence of `InitPlan` and the absence of
`SubPlan`, not the JSON shape.

- [ ] **Step 8: Commit**

```bash
git add infra/supabase-db
git commit -m "feat(db): admin org RLS bypass via vault-backed is_admin_request()"
```

---

### Task 3: Server-side admin identity + the proxy gate

**Files:**

- Create: `apps/web/src/lib/admin/org.ts`
- Modify: `apps/web/src/proxy.ts`
- Modify: `apps/web/.env.example`
- Test: `apps/web/tests/unit/lib/admin/org.test.ts`, `apps/web/tests/unit/proxy.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `adminOrgId(): string | null`, `isAdminOrg(orgId: string | null | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/lib/admin/org.test.ts`:

```ts
import { adminOrgId, isAdminOrg } from '@/lib/admin/org'

describe('admin org', () => {
  const original = process.env.ADMIN_ORG_ID
  afterEach(() => {
    process.env.ADMIN_ORG_ID = original
  })

  it('is nobody when ADMIN_ORG_ID is unset or blank', () => {
    delete process.env.ADMIN_ORG_ID
    expect(adminOrgId()).toBeNull()
    expect(isAdminOrg('org_anything')).toBe(false)
    process.env.ADMIN_ORG_ID = '   '
    expect(adminOrgId()).toBeNull()
    expect(isAdminOrg('org_anything')).toBe(false)
  })

  it('matches only the configured org', () => {
    process.env.ADMIN_ORG_ID = 'org_admin123'
    expect(adminOrgId()).toBe('org_admin123')
    expect(isAdminOrg('org_admin123')).toBe(true)
    expect(isAdminOrg('org_other')).toBe(false)
    expect(isAdminOrg(null)).toBe(false)
    expect(isAdminOrg(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/lib/admin/org.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/admin/org.ts`:

```ts
/**
 * Admin identity is a single Clerk organization id. It is read from the
 * environment here (proxy + server actions) and from Supabase Vault by RLS;
 * both must hold the same value, which getAdminStatusAction() cross-checks.
 *
 * No `server-only` import: the proxy imports this too, and an unset or blank
 * value means "there is no admin org", so every check fails closed.
 */
export const adminOrgId = (): string | null => {
  const value = process.env.ADMIN_ORG_ID?.trim()
  return value ? value : null
}

export const isAdminOrg = (orgId: string | null | undefined): boolean => {
  const configured = adminOrgId()
  return configured !== null && orgId === configured
}
```

- [ ] **Step 4: Run the test**

```bash
yarn workspace @ws/web test:unit -- tests/unit/lib/admin/org.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the proxy gate**

Rewrite `apps/web/src/proxy.ts`:

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdminOrg } from '@/lib/admin/org'
import { PUBLIC_ROUTES } from '@/lib/auth/public-routes'

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
// The one /admin path a non-active admin may reach: it activates the org (or
// 404s for everyone else). Without this exemption a genuine admin whose
// organisation is merely inactive could never get in.
const isAdminActivateRoute = createRouteMatcher(['/admin/activate'])

/**
 * Next 16 proxy (formerly middleware): every non-public route requires a
 * Clerk session; signed-out visitors are sent to sign-in with redirect_url.
 *
 * Layer 1 of the admin gate — the console is unreachable unless the session's
 * ACTIVE organisation is ADMIN_ORG_ID. The layout and every admin server
 * action repeat the check; none of them trusts this one.
 */
export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect()
    }
    if (isAdminRoute(req) && !isAdminActivateRoute(req)) {
      const { orgId } = await auth()
      if (!isAdminOrg(orgId)) {
        return NextResponse.redirect(new URL('/admin/activate', req.url))
      }
    }
    return undefined
  },
  // Routing lives in code (mirrored by ClerkProvider props) so no per-environment env vars can drift.
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
)

export const config = {
  matcher: [
    // Skip Next internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|avif)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

- [ ] **Step 6: Test the proxy's routing decision**

Create `apps/web/tests/unit/proxy.test.ts`:

```ts
interface AuthResult {
  orgId: string | null
}
const protect = jest.fn<Promise<void>, []>()
const authState: AuthResult = { orgId: null }
let handler: (
  auth: (() => Promise<AuthResult>) & { protect: () => Promise<void> },
  req: Request,
) => Promise<Response | undefined>

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (
    fn: (
      auth: (() => Promise<AuthResult>) & { protect: () => Promise<void> },
      req: Request,
    ) => Promise<Response | undefined>,
  ) => {
    handler = fn
    return fn
  },
  createRouteMatcher: (patterns: string[]) => (req: Request) => {
    const path = new URL(req.url).pathname
    return patterns.some((p) =>
      p === '/admin(.*)'
        ? path.startsWith('/admin')
        : p === '/admin/activate'
          ? path === '/admin/activate'
          : path === p,
    )
  },
}))

import '@/proxy'

const auth = Object.assign(async () => authState, { protect })

const run = async (path: string) =>
  handler(auth, new Request(`http://localhost:3001${path}`))

describe('proxy admin gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ADMIN_ORG_ID = 'org_admin123'
  })

  it('redirects /admin to the activation route when the active org is not the admin org', async () => {
    authState.orgId = null
    const res = await run('/admin')
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/admin/activate')
  })

  it('lets the admin org through', async () => {
    authState.orgId = 'org_admin123'
    expect(await run('/admin')).toBeUndefined()
  })

  it('never redirects the activation route itself (no loop)', async () => {
    authState.orgId = null
    expect(await run('/admin/activate')).toBeUndefined()
  })

  it('leaves non-admin routes alone', async () => {
    authState.orgId = null
    expect(await run('/dashboard')).toBeUndefined()
    expect(protect).toHaveBeenCalled()
  })
})
```

Run:

```bash
yarn workspace @ws/web test:unit -- tests/unit/proxy.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 7: Document the variable**

Add to `apps/web/.env.example`:

```
# Clerk organization whose members may use /admin. Must equal the Supabase
# Vault secret `admin_org_id` (set with `yarn admin:set-org` from
# infra/supabase-db) — the app compares the two and warns if they differ.
ADMIN_ORG_ID=
```

- [ ] **Step 8: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(web): admin org identity helper and proxy gate"
```

---

### Task 4: Admin server actions

**Files:**

- Create: `apps/web/src/actions/admin.action.ts`
- Test: `apps/web/tests/unit/actions/admin.action.test.ts`

**Interfaces:**

- Consumes: `isAdminOrg`/`adminOrgId` (Task 3), `generateDeviceId`/`generateDeviceSecret` (Task 1), `set_admin_org_id`/`is_admin_request` exist in the DB (Task 2).
- Produces:
  - `getAdminStatusAction(): Promise<ActionResult<AdminStatus>>` where `AdminStatus = { state: 'ok'; configMismatch: boolean } | { state: 'needs-activation'; orgId: string } | { state: 'denied' }`
  - `createDeviceAction(): Promise<ActionResult<{ deviceId: string; secret: string }>>`
  - `rotateDeviceSecretAction(input: { deviceId: string }): Promise<ActionResult<{ secret: string }>>`
  - `unclaimDeviceAction(input: { deviceId: string }): Promise<ActionResult<null>>`
  - `deleteDeviceAction(input: { deviceId: string; confirmation: string }): Promise<ActionResult<null>>`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/actions/admin.action.test.ts`:

```ts
const auth = jest.fn<Promise<{ userId: string | null; orgId: string | null }>, []>()
const getOrganizationMembershipList = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => auth(),
  clerkClient: async () => ({
    users: { getOrganizationMembershipList },
  }),
}))

const insert = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const update = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const del = jest.fn<Promise<{ error: unknown }>, []>()
const vaultValue = jest.fn<Promise<{ data: unknown; error: unknown }>, []>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: unknown) => insert(row),
      update: (patch: unknown) => ({ eq: async () => update(patch) }),
      delete: () => ({ eq: async () => del() }),
    }),
    rpc: async () => vaultValue(),
  }),
}))

import {
  createDeviceAction,
  deleteDeviceAction,
  getAdminStatusAction,
  rotateDeviceSecretAction,
  unclaimDeviceAction,
} from '@/actions/admin.action'

describe('admin actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ADMIN_ORG_ID = 'org_admin123'
    auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_admin123' })
    vaultValue.mockResolvedValue({ data: 'org_admin123', error: null })
  })

  it.each([
    ['no session', { userId: null, orgId: null }],
    ['a different active org', { userId: 'user_1', orgId: 'org_other' }],
  ])('createDeviceAction refuses %s', async (_label, session) => {
    auth.mockResolvedValue(session)
    await expect(createDeviceAction()).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it('createDeviceAction inserts a well-formed id and secret and returns both once', async () => {
    insert.mockResolvedValue({ error: null })
    const res = await createDeviceAction()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.deviceId).toMatch(/^ws-[0-9a-f]{12}$/)
    expect(res.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: res.data.deviceId,
        status: 'unregistered',
      }),
    )
  })

  it('createDeviceAction retries a colliding id', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } })
      .mockResolvedValueOnce({ error: null })
    await expect(createDeviceAction()).resolves.toMatchObject({ ok: true })
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('rotateDeviceSecretAction writes a new secret and returns it', async () => {
    update.mockResolvedValue({ error: null })
    const res = await rotateDeviceSecretAction({ deviceId: 'ws-1' })
    expect(res.ok && res.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ secret: expect.any(String) as string }),
    )
  })

  it('deleteDeviceAction requires the device id typed as confirmation', async () => {
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-2' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(del).not.toHaveBeenCalled()
    del.mockResolvedValue({ error: null })
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('unclaimDeviceAction deletes the device links only', async () => {
    del.mockResolvedValue({ error: null })
    await expect(
      unclaimDeviceAction({ deviceId: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
    expect(del).toHaveBeenCalled()
  })

  describe('getAdminStatusAction', () => {
    it('reports ok, and flags a mismatch between the env and the vault', async () => {
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: false },
      })
      vaultValue.mockResolvedValue({ data: 'org_stale', error: null })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: true },
      })
    })

    it('asks for activation when the caller belongs to the admin org but has not activated it', async () => {
      auth.mockResolvedValue({ userId: 'user_1', orgId: null })
      getOrganizationMembershipList.mockResolvedValue({
        data: [{ organization: { id: 'org_admin123' } }],
      })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'needs-activation', orgId: 'org_admin123' },
      })
    })

    it('denies a user who is in no admin org', async () => {
      auth.mockResolvedValue({ userId: 'user_1', orgId: null })
      getOrganizationMembershipList.mockResolvedValue({
        data: [{ organization: { id: 'org_unrelated' } }],
      })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'denied' },
      })
    })
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/actions/admin.action.test.ts
```

Expected: FAIL — `@/actions/admin.action` not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/actions/admin.action.ts`:

```ts
'use server'

import 'server-only'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { generateDeviceId, generateDeviceSecret } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { adminOrgId, isAdminOrg } from '@/lib/admin/org'

export type AdminStatus =
  | { state: 'ok'; configMismatch: boolean }
  | { state: 'needs-activation'; orgId: string }
  | { state: 'denied' }

// A non-admin must not learn that the console exists, so every refusal is the
// same NOT_FOUND the UI turns into a 404 — never a distinguishable 403.
const DENIED = 'Not found'
const deviceIdSchema = z.object({ deviceId: z.string().min(3).max(64) })

/** Layer 3 of the gate: re-derived per call, never inherited from the page. */
const requireAdmin = async (): Promise<
  { ok: true } | { ok: false; result: ActionResult<never> }
> => {
  const { userId, orgId } = await auth()
  if (!userId || !isAdminOrg(orgId)) {
    return { ok: false, result: actionError('NOT_FOUND', DENIED) }
  }
  return { ok: true }
}

/** The value RLS uses, read back through the service role for the drift check. */
const vaultAdminOrgId = async (): Promise<string | null> => {
  const { data, error } = await createServiceRoleClient().rpc(
    'admin_org_id_configured',
  )
  if (error) return null
  return typeof data === 'string' ? data : null
}

export const getAdminStatusAction = async (): Promise<
  ActionResult<AdminStatus>
> => {
  const { userId, orgId } = await auth()
  if (!userId) return actionOk({ state: 'denied' })

  const configured = adminOrgId()
  if (!configured) return actionOk({ state: 'denied' })

  if (orgId === configured) {
    const fromVault = await vaultAdminOrgId()
    return actionOk({ state: 'ok', configMismatch: fromVault !== configured })
  }

  // Active organisation is not the admin one — but membership is what decides
  // whether this user may activate it.
  const client = await clerkClient()
  const memberships = await client.users.getOrganizationMembershipList({
    userId,
    limit: 100,
  })
  const isMember = memberships.data.some(
    (m) => m.organization.id === configured,
  )
  return actionOk(
    isMember
      ? { state: 'needs-activation', orgId: configured }
      : { state: 'denied' },
  )
}

const MAX_ID_ATTEMPTS = 5

export const createDeviceAction = async (): Promise<
  ActionResult<{ deviceId: string; secret: string }>
> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result

  const service = createServiceRoleClient()
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const deviceId = generateDeviceId()
    const secret = generateDeviceSecret()
    const { error } = await service
      .from('devices')
      .insert({ device_id: deviceId, secret, status: 'unregistered' })
    if (!error) return actionOk({ deviceId, secret })
    // 23505 is a device_id collision — vanishingly unlikely, cheap to retry.
    if (error.code !== '23505') {
      console.error('createDeviceAction failed', error)
      return actionError('UNKNOWN', 'Could not create the device. Try again.')
    }
  }
  return actionError('UNKNOWN', 'Could not mint a unique device id. Try again.')
}

export const rotateDeviceSecretAction = async (input: {
  deviceId: string
}): Promise<ActionResult<{ secret: string }>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown device')

  const secret = generateDeviceSecret()
  const { error } = await createServiceRoleClient()
    .from('devices')
    .update({ secret })
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('rotateDeviceSecretAction failed', error)
    return actionError('UNKNOWN', 'Could not rotate the secret. Try again.')
  }
  return actionOk({ secret })
}

/**
 * Drops every membership so the device_users_after_delete trigger flips the
 * device back to 'unregistered' and it can be claimed again. The device row
 * and its readings survive.
 */
export const unclaimDeviceAction = async (input: {
  deviceId: string
}): Promise<ActionResult<null>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown device')

  const { error } = await createServiceRoleClient()
    .from('device_users')
    .delete()
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('unclaimDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not unclaim the device. Try again.')
  }
  return actionOk(null)
}

/** Destroys the device and, by cascade, its readings. Confirmation is the id. */
export const deleteDeviceAction = async (input: {
  deviceId: string
  confirmation: string
}): Promise<ActionResult<null>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema
    .extend({ confirmation: z.string() })
    .safeParse(input)
  if (!parsed.success || parsed.data.confirmation.trim() !== parsed.data.deviceId) {
    return actionError('INVALID_INPUT', 'Type the device id to confirm', {
      confirmation: 'Type the device id to confirm',
    })
  }

  const { error } = await createServiceRoleClient()
    .from('devices')
    .delete()
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('deleteDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not delete the device. Try again.')
  }
  return actionOk(null)
}
```

- [ ] **Step 4: Add the read-back RPC used by the drift check**

The action calls `admin_org_id_configured()`; add it to the Task 2 migration
file (it has not shipped yet, so amend rather than write a second migration):

```sql
-- Lets the app read back what RLS will compare against, so the console can
-- warn when ADMIN_ORG_ID and the Vault secret have drifted apart. Service role
-- only — clients have no business reading it.
create or replace function public.admin_org_id_configured()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id';
$$;

revoke execute on function public.admin_org_id_configured() from public, anon, authenticated;
grant execute on function public.admin_org_id_configured() to service_role;
```

Then:

```bash
cd infra/supabase-db && yarn db-reset:local && yarn regenerate:types && yarn test:db
infisical run -- yarn admin:set-org org_localdevadminorg000
```

Expected: `Result: PASS`, and `admin_org_id_configured` appears in
`src/types/database.ts`.

- [ ] **Step 5: Run the action tests**

```bash
yarn workspace @ws/web test:unit -- tests/unit/actions/admin.action.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 6: Commit**

```bash
yarn format
git add apps/web infra/supabase-db
git commit -m "feat(admin): server actions for status, create, rotate, unclaim, delete"
```

---

### Task 5: Fleet read services and hooks

**Files:**

- Create: `apps/web/src/services/admin/admin.service.ts`
- Create: `apps/web/src/services/admin/admin.queries.ts`
- Test: `apps/web/tests/unit/services/admin/admin.service.test.ts`, `apps/web/tests/integration/services/admin/admin.service.integration.test.ts`

**Interfaces:**

- Consumes: the admin policies (Task 2), the actions (Task 4).
- Produces:
  - `interface AdminDevice { deviceId: string; status: DeviceStatus; label: string | null; createdAt: string; memberCount: number }`
  - `fetchAllDevices(supabase): Promise<AdminDevice[]>`
  - `interface AdminUser { id: string; clerkUserId: string | null; telegramId: number | null; createdAt: string; deviceCount: number }`
  - `fetchAllUsers(supabase): Promise<AdminUser[]>`
  - `adminKeys`, `useAdminDevicesQuery()`, `useAdminUsersQuery()`, and mutation hooks `useCreateDeviceMutation()`, `useRotateSecretMutation()`, `useUnclaimDeviceMutation()`, `useDeleteDeviceMutation()`

- [ ] **Step 1: Write the failing service test**

Create `apps/web/tests/unit/services/admin/admin.service.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import { fetchAllDevices, fetchAllUsers } from '@/services/admin/admin.service'

const clientReturning = (result: { data: unknown; error: unknown }) => {
  const chain = {
    select: jest.fn(() => chain),
    order: jest.fn(async () => result),
  }
  return {
    client: { from: jest.fn(() => chain) } as unknown as SupabaseClient<Database>,
    chain,
  }
}

describe('fetchAllDevices', () => {
  it('aliases columns and counts members from the embedded links', async () => {
    const { client, chain } = clientReturning({
      data: [
        {
          deviceId: 'ws-1',
          status: 'registered',
          label: 'Backyard',
          createdAt: '2026-08-01T00:00:00Z',
          members: [{ count: 2 }],
        },
      ],
      error: null,
    })
    await expect(fetchAllDevices(client)).resolves.toEqual([
      {
        deviceId: 'ws-1',
        status: 'registered',
        label: 'Backyard',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 2,
      },
    ])
    expect(chain.select).toHaveBeenCalledWith(
      'deviceId:device_id, status, label, createdAt:created_at, members:device_users(count)',
    )
  })

  it('throws ServiceError when RLS refuses', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'denied', code: '42501', details: null },
    })
    await expect(fetchAllDevices(client)).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('fetchAllUsers', () => {
  it('aliases columns and counts each user’s stations', async () => {
    const { client, chain } = clientReturning({
      data: [
        {
          id: 'u1',
          clerkUserId: 'user_abcd',
          telegramId: null,
          createdAt: '2026-08-01T00:00:00Z',
          devices: [{ count: 3 }],
        },
      ],
      error: null,
    })
    await expect(fetchAllUsers(client)).resolves.toEqual([
      {
        id: 'u1',
        clerkUserId: 'user_abcd',
        telegramId: null,
        createdAt: '2026-08-01T00:00:00Z',
        deviceCount: 3,
      },
    ])
    expect(chain.select).toHaveBeenCalledWith(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at, devices:device_users(count)',
    )
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/services/admin
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `apps/web/src/services/admin/admin.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceStatus } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface AdminDevice {
  deviceId: string
  status: DeviceStatus
  label: string | null
  createdAt: string
  memberCount: number
}

export interface AdminUser {
  id: string
  clerkUserId: string | null
  telegramId: number | null
  createdAt: string
  deviceCount: number
}

// PostgREST returns an embedded aggregate as `[{ count: n }]`; that shape is
// the one thing these two services map by hand.
const countOf = (rows: { count: number }[] | null | undefined): number =>
  rows?.[0]?.count ?? 0

/**
 * Every device in the fleet. Readable only because the caller's session is in
 * the admin organisation — the "admin org can view all devices" policy ORs
 * with the member policy, so a normal user running this sees only their own.
 * `secret` is absent by column grant and cannot be selected here.
 */
export const fetchAllDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminDevice[]> => {
  const { data, error } = await supabase
    .from('devices')
    .select(
      'deviceId:device_id, status, label, createdAt:created_at, members:device_users(count)',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch devices: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    deviceId: row.deviceId,
    status: row.status as DeviceStatus,
    label: row.label,
    createdAt: row.createdAt,
    memberCount: countOf(row.members),
  }))
}

/** Every app user with how many stations they can see. */
export const fetchAllUsers = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminUser[]> => {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at, devices:device_users(count)',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch users: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    clerkUserId: row.clerkUserId,
    telegramId: row.telegramId,
    createdAt: row.createdAt,
    deviceCount: countOf(row.devices),
  }))
}
```

- [ ] **Step 4: Implement the hooks**

Create `apps/web/src/services/admin/admin.queries.ts`:

```ts
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { fetchAllDevices, fetchAllUsers } from './admin.service'

import {
  createDeviceAction,
  deleteDeviceAction,
  rotateDeviceSecretAction,
  unclaimDeviceAction,
} from '@/actions/admin.action'
import { unwrapAction } from '@/lib/actions/unwrap'
import { useSupabaseClient } from '@/lib/supabase'

export const adminKeys = {
  all: ['admin'] as const,
  devices: ['admin', 'devices'] as const,
  users: ['admin', 'users'] as const,
}

export const useAdminDevicesQuery = (enabled: boolean) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: adminKeys.devices,
    queryFn: () => fetchAllDevices(client),
    enabled,
  })
}

export const useAdminUsersQuery = (enabled: boolean) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: () => fetchAllUsers(client),
    enabled,
  })
}

const useInvalidateFleet = () => {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    [queryClient],
  )
}

export const useCreateDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async () => unwrapAction(await createDeviceAction()),
    onSuccess: invalidate,
  })
}

export const useRotateSecretMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string }) =>
      unwrapAction(await rotateDeviceSecretAction(input)),
    onSuccess: invalidate,
  })
}

export const useUnclaimDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string }) =>
      unwrapAction(await unclaimDeviceAction(input)),
    onSuccess: invalidate,
  })
}

export const useDeleteDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string; confirmation: string }) =>
      unwrapAction(await deleteDeviceAction(input)),
    onSuccess: invalidate,
  })
}
```

- [ ] **Step 5: Write the integration test**

Create `apps/web/tests/integration/services/admin/admin.service.integration.test.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createAdminClient, createUserClient } from '../../helpers/auth-client'

import { fetchAllDevices, fetchAllUsers } from '@/services/admin/admin.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const ADMIN_ORG = 'org_inttest_admin'
const CLERK_ADMIN = 'user_inttest_admin'
const CLERK_PLAIN = 'user_inttest_plain'
const DEVICE_A = 'ws-inttestadmin1'
const DEVICE_B = 'ws-inttestadmin2'

beforeAll(async () => {
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).')
  }
  const { error } = await db.rpc('set_admin_org_id', { p_org_id: ADMIN_ORG })
  if (error) throw new Error(error.message)
})

afterEach(async () => {
  await db.from('devices').delete().in('device_id', [DEVICE_A, DEVICE_B])
  await db.from('users').delete().in('clerk_user_id', [CLERK_ADMIN, CLERK_PLAIN])
})

describe('admin fleet reads (integration)', () => {
  it('the admin org sees every device and user; a normal user sees only their own', async () => {
    const { data: admin } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_ADMIN })
      .select('id')
      .single()
    const { data: plain } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_PLAIN })
      .select('id')
      .single()
    await db.from('devices').insert([
      { device_id: DEVICE_A, secret: 'a'.repeat(64), status: 'registered' },
      { device_id: DEVICE_B, secret: 'b'.repeat(64), status: 'registered' },
    ])
    await db
      .from('device_users')
      .insert({ device_id: DEVICE_B, user_id: plain!.id, role: 'owner' })

    const asAdmin = createAdminClient(CLERK_ADMIN, ADMIN_ORG)
    const devices = await fetchAllDevices(asAdmin)
    expect(devices.map((d) => d.deviceId).sort()).toEqual(
      [DEVICE_A, DEVICE_B].sort(),
    )
    expect(devices.find((d) => d.deviceId === DEVICE_B)?.memberCount).toBe(1)

    const users = await fetchAllUsers(asAdmin)
    expect(users.map((u) => u.clerkUserId)).toEqual(
      expect.arrayContaining([CLERK_ADMIN, CLERK_PLAIN]),
    )
    expect(users.find((u) => u.id === plain!.id)?.deviceCount).toBe(1)
    expect(admin).toBeTruthy()

    // Same code, ordinary session: RLS narrows it to their own rows.
    const asPlain = createUserClient(CLERK_PLAIN)
    expect((await fetchAllDevices(asPlain)).map((d) => d.deviceId)).toEqual([
      DEVICE_B,
    ])
    expect((await fetchAllUsers(asPlain)).map((u) => u.clerkUserId)).toEqual([
      CLERK_PLAIN,
    ])
  })

  it('an admin still cannot read devices.secret', async () => {
    await db
      .from('devices')
      .insert({ device_id: DEVICE_A, secret: 'a'.repeat(64), status: 'registered' })
    const asAdmin = createAdminClient(CLERK_ADMIN, ADMIN_ORG)
    const { error } = await asAdmin.from('devices').select('secret').limit(1)
    expect(error?.code).toBe('42501')
  })

  it('the vault value matches ADMIN_ORG_ID when the app environment is configured', async () => {
    const configured = process.env.ADMIN_ORG_ID
    if (!configured) return
    const { data } = await db.rpc('admin_org_id_configured')
    expect(data).toBe(configured)
  })
})
```

- [ ] **Step 6: Extend the test auth helper**

Add to `apps/web/tests/integration/helpers/auth-client.ts`:

```ts
/**
 * A session whose ACTIVE organisation is `orgId` — the shape Clerk emits once
 * an org is activated, and the only shape is_admin_request() accepts.
 */
export const signTestJwtWithOrg = (
  clerkUserId: string,
  orgId: string,
): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: clerkUserId,
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase-test',
      org_id: orgId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

export const createAdminClient = (
  clerkUserId: string,
  orgId: string,
): SupabaseClient<Database> => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (npx supabase status).',
    )
  }
  const token = signTestJwtWithOrg(clerkUserId, orgId)
  return createClient<Database>(url, key, { accessToken: async () => token })
}
```

- [ ] **Step 7: Run both suites**

```bash
yarn workspace @ws/web test:unit -- tests/unit/services/admin
yarn workspace @ws/web test:integration:secrets
```

Expected: PASS. Restore the local Vault value afterwards, since the integration
test overwrote it:

```bash
cd infra/supabase-db && infisical run -- yarn admin:set-org org_localdevadminorg000
```

- [ ] **Step 8: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(admin): fleet read services and TanStack hooks"
```

---

### Task 6: Admin routes, gate and shell

**Files:**

- Create: `apps/web/src/app/(app)/admin/layout.tsx`, `page.tsx`, `users/page.tsx`, `activate/page.tsx`
- Create: `apps/web/src/components/admin/ActivateAdminOrg.tsx`, `ConfigMismatchBanner.tsx`
- Modify: `apps/web/src/components/shell/nav-items.ts`, `apps/web/src/components/shell/TopNav.tsx`
- Test: `apps/web/tests/unit/components/admin/ActivateAdminOrg.test.tsx`

**Interfaces:**

- Consumes: `getAdminStatusAction` (Task 4).
- Produces: `/admin`, `/admin/users`, `/admin/activate`; `NAV_ITEMS` unchanged plus an admin-only entry rendered by `TopNav`.

- [ ] **Step 1: Write the failing activation test**

Create `apps/web/tests/unit/components/admin/ActivateAdminOrg.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'

import { routerState } from '../../../stubs/next-navigation'

const status = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/admin.action', () => ({
  getAdminStatusAction: () => status(),
}))
const setActive = jest.fn<Promise<void>, [unknown]>()
jest.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ setActive }),
}))
const notFound = jest.fn()
jest.mock('next/navigation', () => ({
  ...jest.requireActual<Record<string, unknown>>(
    '../../../stubs/next-navigation',
  ),
  notFound: () => notFound(),
}))

import { ActivateAdminOrg } from '@/components/admin/ActivateAdminOrg'

describe('ActivateAdminOrg', () => {
  beforeEach(() => jest.clearAllMocks())

  it('activates the admin org and continues to the console', async () => {
    status.mockResolvedValue({
      ok: true,
      data: { state: 'needs-activation', orgId: 'org_admin123' },
    })
    render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith({
        organization: 'org_admin123',
      }),
    )
    await waitFor(() =>
      expect(routerState.replace).toHaveBeenCalledWith('/admin'),
    )
  })

  it('goes straight through when the org is already active', async () => {
    status.mockResolvedValue({ ok: true, data: { state: 'ok', configMismatch: false } })
    render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() =>
      expect(routerState.replace).toHaveBeenCalledWith('/admin'),
    )
    expect(setActive).not.toHaveBeenCalled()
  })

  it('404s a user who is not in the admin org', async () => {
    status.mockResolvedValue({ ok: true, data: { state: 'denied' } })
    render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() => expect(notFound).toHaveBeenCalled())
    expect(screen.queryByTestId('activate-working')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/admin
```

Expected: FAIL — component missing.

- [ ] **Step 3: Implement the activation component**

Create `apps/web/src/components/admin/ActivateAdminOrg.tsx`:

```tsx
'use client'

import { useClerk } from '@clerk/nextjs'
import { notFound, useRouter } from 'next/navigation'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'

import { getAdminStatusAction } from '@/actions/admin.action'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * The only /admin path the proxy lets a non-active session reach. Clerk only
 * puts `org_id` in the session token for the ACTIVE organisation, so a genuine
 * admin has to activate it once before either enforcer can see them.
 */
export const ActivateAdminOrg = ({
  testId,
}: {
  testId: string
}): ReactElement | null => {
  const router = useRouter()
  const { setActive } = useClerk()
  const [denied, setDenied] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const run = async () => {
      const res = await getAdminStatusAction()
      if (!res.ok || res.data.state === 'denied') {
        setDenied(true)
        return
      }
      if (res.data.state === 'needs-activation') {
        await setActive({ organization: res.data.orgId })
      }
      router.replace('/admin')
    }
    void run()
  }, [router, setActive])

  if (denied) notFound()
  return <Skeleton testId={`${testId}-working`} className="h-24" />
}
```

- [ ] **Step 4: Add the routes**

`apps/web/src/app/(app)/admin/activate/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { ActivateAdminOrg } from '@/components/admin/ActivateAdminOrg'

export const metadata: Metadata = { title: 'Admin' }

const AdminActivatePage = (): ReactElement => (
  <ActivateAdminOrg testId="admin-activate" />
)

export default AdminActivatePage
```

`apps/web/src/app/(app)/admin/layout.tsx` — layer 2 of the gate:

```tsx
import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import type { ReactElement, ReactNode } from 'react'

import { isAdminOrg } from '@/lib/admin/org'

/**
 * Layer 2: the proxy already redirects non-admins, but a layout that trusts
 * the proxy would hand the whole console to anything that slips past the
 * matcher. 404, never 403 — the console's existence is not public.
 */
const AdminLayout = async ({
  children,
}: {
  children: ReactNode
}): Promise<ReactElement> => {
  const { orgId } = await auth()
  if (!isAdminOrg(orgId)) notFound()
  return <section data-testid="admin-shell">{children}</section>
}

export default AdminLayout
```

`apps/web/src/app/(app)/admin/page.tsx` and `users/page.tsx` render the tables
built in Task 7; until then they render a placeholder heading so the routes
compile:

```tsx
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

export const metadata: Metadata = { title: 'Admin · Devices' }

const AdminDevicesPage = (): ReactElement => (
  <h1 className="text-xl font-semibold tracking-tight">Fleet</h1>
)

export default AdminDevicesPage
```

- [ ] **Step 5: Show the nav entry only to admins**

In `apps/web/src/components/shell/nav-items.ts` add:

```ts
/** Rendered only when the session's active org is the admin org. */
export const ADMIN_NAV_ITEM: NavItem = {
  key: 'admin',
  href: '/admin',
  label: 'Admin',
}
```

In `TopNav`, accept `showAdmin: boolean` and render `[...NAV_ITEMS, ...(showAdmin ? [ADMIN_NAV_ITEM] : [])]` (memoised). `AppShell` supplies it from `useAuth().orgId === process.env.NEXT_PUBLIC_ADMIN_ORG_ID` — **do not add that public variable**; instead call `getAdminStatusAction()` once in `AppShell` through a TanStack query keyed `adminKeys.all` and pass `data?.state === 'ok'`. A hidden link is cosmetic; the three real gates already hold.

- [ ] **Step 6: Run the tests**

```bash
yarn workspace @ws/web test:unit
yarn check-types
yarn lint
```

Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(admin): routes, layout gate, org activation and nav entry"
```

---

### Task 7: The console UI

**Files:**

- Create: `apps/web/src/components/admin/AdminDevicesTable.tsx`, `CreateDeviceDialog.tsx`, `SecretReveal.tsx`, `DeviceRowActions.tsx`, `AdminUsersTable.tsx`, `ConfigMismatchBanner.tsx`
- Modify: `apps/web/src/app/(app)/admin/page.tsx`, `apps/web/src/app/(app)/admin/users/page.tsx`
- Test: `apps/web/tests/unit/components/admin/AdminDevicesTable.test.tsx`, `SecretReveal.test.tsx`

**Interfaces:**

- Consumes: Task 5's hooks and types.
- Produces: no exported types beyond components.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/components/admin/SecretReveal.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { SecretReveal } from '@/components/admin/SecretReveal'

describe('SecretReveal', () => {
  it('shows the id and secret with a shown-once warning', () => {
    render(
      <SecretReveal
        testId="reveal"
        deviceId="ws-3f2a9b7c1d0e"
        secret={'a'.repeat(64)}
      />,
    )
    expect(screen.getByTestId('reveal-device-id')).toHaveTextContent(
      'ws-3f2a9b7c1d0e',
    )
    expect(screen.getByTestId('reveal-secret')).toHaveTextContent('a'.repeat(64))
    expect(screen.getByTestId('reveal-warning')).toHaveTextContent('once')
  })
})
```

Create `apps/web/tests/unit/components/admin/AdminDevicesTable.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import type { AdminDevice } from '@/services/admin/admin.service'

const devices: { data: AdminDevice[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
jest.mock('@/services/admin/admin.queries', () => ({
  adminKeys: { all: ['admin'], devices: ['admin', 'devices'] },
  useAdminDevicesQuery: () => devices,
  useCreateDeviceMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRotateSecretMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUnclaimDeviceMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDeleteDeviceMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { AdminDevicesTable } from '@/components/admin/AdminDevicesTable'

describe('AdminDevicesTable', () => {
  it('renders a skeleton while loading', () => {
    devices.isLoading = true
    render(<AdminDevicesTable testId="fleet" />)
    expect(screen.getByTestId('fleet-skeleton')).toBeInTheDocument()
  })

  it('renders one row per device and never a secret column', () => {
    devices.isLoading = false
    devices.data = [
      {
        deviceId: 'ws-1',
        status: 'registered',
        label: 'Backyard',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 2,
      },
      {
        deviceId: 'ws-2',
        status: 'unregistered',
        label: null,
        createdAt: '2026-08-02T00:00:00Z',
        memberCount: 0,
      },
    ]
    render(<AdminDevicesTable testId="fleet" />)
    expect(screen.getByTestId('fleet-row-ws-1')).toHaveTextContent('Backyard')
    expect(screen.getByTestId('fleet-row-ws-2')).toHaveTextContent(
      'unregistered',
    )
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and watch them fail**

```bash
yarn workspace @ws/web test:unit -- tests/unit/components/admin
```

Expected: FAIL — components missing.

- [ ] **Step 3: Implement `SecretReveal`**

Create `apps/web/src/components/admin/SecretReveal.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { Button } from '@/components/ui/Button'

/**
 * The only place a device secret is ever rendered. It arrives from a server
 * action, lives in component state, and is never re-fetchable — losing it means
 * rotating, which is deliberate: a fleet-wide "reveal secret" affordance would
 * make every admin session a standing key-exfiltration path.
 */
export const SecretReveal = ({
  deviceId,
  secret,
  testId,
}: {
  deviceId: string
  secret: string
  testId: string
}): ReactElement => {
  const copyId = useCallback(() => {
    void navigator.clipboard.writeText(deviceId)
  }, [deviceId])
  const copySecret = useCallback(() => {
    void navigator.clipboard.writeText(secret)
  }, [secret])

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <code data-testid={`${testId}-device-id`} className="font-mono text-sm">
          {deviceId}
        </code>
        <Button testId={`${testId}-copy-id`} variant="ghost" size="sm" onClick={copyId}>
          Copy id
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <code
          data-testid={`${testId}-secret`}
          className="font-mono text-xs break-all"
        >
          {secret}
        </code>
        <Button
          testId={`${testId}-copy-secret`}
          variant="ghost"
          size="sm"
          onClick={copySecret}
        >
          Copy secret
        </Button>
      </div>
      <p
        data-testid={`${testId}-warning`}
        className="text-danger text-[13px] font-medium"
      >
        Shown once. Flash it now — nobody can read it again; you can only
        rotate it.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Implement the tables and dialogs**

Build, following the patterns already in `components/devices/`:

- `CreateDeviceDialog` — a Dialog whose primary button calls
  `useCreateDeviceMutation().mutateAsync()`, then swaps its body for
  `<SecretReveal />`; closing clears the secret from state.
- `DeviceRowActions` — `Rotate secret` (confirm → `SecretReveal` in a dialog),
  `Unclaim` (confirm; explains the device becomes claimable again),
  `Delete` (typed-confirmation dialog that requires the device id and states
  that readings are destroyed).
- `AdminDevicesTable` — `useAdminDevicesQuery(true)`; skeleton while
  `isLoading`; columns id, label, status badge, members, created; row actions.
  No column, tooltip or title anywhere may contain a secret.
- `AdminUsersTable` — `useAdminUsersQuery(true)`; masked identifier tails via
  the existing `maskIdentifier` helper shape, Telegram yes/no, station count.
- `ConfigMismatchBanner` — renders when `getAdminStatusAction()` reports
  `configMismatch`, naming both stores and how to fix them.

Wire `AdminDevicesTable` + `ConfigMismatchBanner` into
`app/(app)/admin/page.tsx` and `AdminUsersTable` into
`app/(app)/admin/users/page.tsx`.

- [ ] **Step 5: Run the tests**

```bash
yarn workspace @ws/web test:unit
yarn check-types
yarn lint
```

Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
yarn format
git add apps/web
git commit -m "feat(admin): fleet and user tables with one-time secret reveal"
```

---

### Task 8: Documentation, gate and browser verification

**Files:**

- Modify: `CLAUDE.md`, `docs/privacy-data-minimisation.md`, `apps/web/.env.example`, `README.md`
- Create: `docs/superpowers/verification/2026-08-16-admin-console.md`

- [ ] **Step 1: Document the admin path in CLAUDE.md**

Add to the environment-variable table:

```markdown
| `ADMIN_ORG_ID`                         | Server        | Clerk org whose members may use `/admin`; must equal the Vault secret `admin_org_id` |
```

And a short subsection under the architecture section stating: admin reads run
on the client path through the `is_admin_request()` policies; admin writes are
server actions; admin RLS predicates must never reference a row column; and
`devices.secret` is still ungranted to every role.

- [ ] **Step 2: Record the privacy widening**

In `docs/privacy-data-minimisation.md`, add a row and a paragraph: members of
the admin org can read all `users` rows (full `clerk_user_id` / `telegram_id`)
through RLS, the UI masks them to tails, and narrowing this later means
dropping one policy.

- [ ] **Step 3: Document the ops steps in README**

A short "Admin console" section: create the Clerk organization, add admins to
it, set `ADMIN_ORG_ID` in Infisical/Vercel, run
`yarn admin:set-org <org_id>` against each Supabase environment, and note that
a `db-reset:local` clears the Vault secret so it must be re-set.

- [ ] **Step 4: Run the whole gate**

```bash
yarn format && yarn lint && yarn check-types && yarn test:unit
yarn workspace @ws/web test:integration:secrets
cd infra/supabase-db && yarn db-reset:local && yarn test:db && infisical run -- yarn admin:set-org "$ADMIN_ORG_ID" && cd ../..
infisical run -- yarn build
```

- [ ] **Step 5: Verify in a real browser**

Create a Clerk organization, add your user, set `ADMIN_ORG_ID` and the Vault
secret to its id, restart the dev server, then check:

1. Signed in **without** the org active, visiting `/admin` → redirected to
   `/admin/activate`, which activates the org and lands on the console.
2. The console lists every device, including ones you do not own.
3. **Create device** shows the id and secret once; closing and reopening never
   shows the secret again; the new device appears in the table.
4. The created device can ingest: post a signed reading with that id/secret to
   `/api/v1/readings` and get 201.
5. **Rotate secret** returns a new secret; a reading signed with the old secret
   is now rejected (401), one signed with the new secret succeeds.
6. **Unclaim** on a registered device flips it to `unregistered` and the former
   owner no longer sees it.
7. **Delete** requires typing the device id and removes the row.
8. `/admin/users` lists users with masked tails and station counts.
9. Sign in as a **non-admin** (or deactivate the org): `/admin` redirects to
   `/admin/activate`, which renders a 404 — no console, no data.
10. Set `ADMIN_ORG_ID` to a different value than the Vault secret → the
    mismatch banner appears; restore it afterwards.
11. Console clean throughout.

Write the results into `docs/superpowers/verification/2026-08-16-admin-console.md`
as a check → result table, including anything that failed and how it was fixed.

- [ ] **Step 6: Commit**

```bash
yarn format
git add docs apps CLAUDE.md README.md
git commit -m "docs: admin console ops, privacy widening and verification notes"
```

- [ ] **Step 7: Finish the branch**

**REQUIRED SUB-SKILL:** Use `superpowers:finishing-a-development-branch` — run
the full suite on the merge target, then present the merge/PR/keep menu and wait
for the decision.

---

## Self-Review

**Spec coverage**

| Spec section                          | Task                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| §2 Who is an admin (env + Vault)      | Task 1 (script), Task 2 (RPC), Task 3 (env reader), Task 4 (drift check) |
| §3 Three enforcement layers           | Task 3 (proxy), Task 6 (layout), Task 4 (every action)            |
| §4 Activation step                    | Task 4 (`getAdminStatusAction`), Task 6 (`ActivateAdminOrg`)      |
| §5 RLS per-request rule               | Task 2, incl. the EXPLAIN InitPlan test                           |
| §6 Secrets                            | Task 1 (minting), Task 4 (only two responses), Task 7 (`SecretReveal`) |
| §7 Data paths                         | Task 4 (writes), Task 5 (reads + hooks)                           |
| §8 Screens                            | Task 6 (routes), Task 7 (tables)                                  |
| §9 Privacy consequence                | Task 8 step 2                                                     |
| §10 Testing                           | Tasks 1–7 carry their tests; Task 8 steps 4–5 are the gate        |
| §11 Risks                             | Task 2 (fails closed, secret ungranted), Task 4 (per-call re-check), Task 8 step 5 items 9–10 |

**Placeholders:** none — every step carries literal SQL, TypeScript, or a
command. Task 7 step 4 describes four components by behaviour rather than full
source; each has its test written first in step 1 and follows an existing
component in `components/devices/`, which is the established pattern in this
repo.

**Type consistency:** `AdminStatus` is defined once (Task 4) and consumed in
Task 6; `AdminDevice`/`AdminUser` are defined in Task 5 and used in Task 7;
`adminKeys` is defined in Task 5 and referenced in Tasks 6–7;
`isAdminOrg(orgId)` has the same signature in the proxy (Task 3), the layout
(Task 6) and the actions (Task 4); `generateDeviceId`/`generateDeviceSecret`
are defined in Task 1 and used in Task 4 and the CLI.
