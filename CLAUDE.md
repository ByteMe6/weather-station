# Weather Station — Project Commands & Style Guide

Hyperlocal weather monitoring: ESP32 sensors → Next.js (Vercel) → Supabase,
with a Telegram bot on Supabase Edge Functions. Product requirements live in
`docs/04-prd.md`; architecture in `docs/05-architecture-and-tech-stack.md`.

## Monorepo Structure

Package scope: `@ws/*`. Yarn 4 (corepack) + turbo.

```
apps/web               → Next.js 16 App Router (dashboard + API routes) — Vercel
packages/shared        → Shared types & constants (readings, devices, ingest headers)
packages/eslint-config → ESLint preset (@ws/eslint-config/base)
packages/tsconfig      → TypeScript presets (base.json, nextjs.json)
infra/supabase-db      → DB package: migrations, generated types, service-role client,
                         Supabase Edge Functions (telegram-bot)
firmware/              → ESP32 firmware (PlatformIO + Arduino core) — not a yarn workspace
```

### Dependency Graph

```
apps/web  ──>  @ws/shared
apps/web  ──>  @ws/supabase-db  ──>  @ws/shared
```

## Build & Test Commands

```bash
corepack enable          # once per machine — activates Yarn 4 from packageManager
yarn install

yarn dev                 # dev servers via turbo
yarn build               # build all workspaces
yarn lint                # lint all workspaces (ALWAYS run before completing a task)
yarn check-types         # tsc --noEmit all workspaces
yarn test:unit           # unit tests via turbo
yarn format              # prettier --write
yarn format:check        # CI runs this — keep the tree formatted

yarn workspace @ws/web <script>       # single workspace
```

### Supabase (from `infra/supabase-db/`)

```bash
yarn migrate:new <name>   # new migration (UTC timestamp: YYYYMMDDHHmmss_<name>.sql)
yarn migrate:up           # apply pending migrations locally
yarn db-reset:local       # drop + re-run all migrations + seeds (use before tests)
yarn regenerate:types     # REQUIRED after every migration → src/types/database.ts
yarn deploy:functions     # deploy telegram-bot edge function
```

`db-reset:local` vs `migrate:up`: reset guarantees a clean state and picks up
edits to already-applied migrations; `migrate:up` is incremental only.

### Telegram bot (Deno edge function — not ESLint/tsc territory)

```bash
cd infra/supabase-db
npx supabase functions serve telegram-bot --env-file supabase/functions/.env
```

CI checks it with `deno check` + `deno lint`. Code lives in
`infra/supabase-db/supabase/functions/telegram-bot/`.

### Firmware

See `firmware/README.md`. Per-device config goes in `firmware/secrets.ini`
(gitignored) — never put a real `DEVICE_SECRET` in a tracked file.

---

## Architecture — Two Data Paths

```
CLIENT PATH (RLS enforced) ← DEFAULT, always start here
  Component → Client Action Hook (TanStack Query) → Service → Supabase (user JWT)
  ↳ Clerk session token → Supabase accessToken callback → RLS policies enforce access

SERVER PATH (RLS bypassed) ← Only for operations that need secrets or elevation
  Component → Server Action → Service → Supabase (service-role key)
  ↳ Clerk auth() provides userId → authorization checked in code
```

**CRITICAL: Always default to Client Actions.** The backend serves **no read
endpoints** for sensor data (PRD B3) — the browser and the bot query Supabase
directly and RLS isolates per-user data via `device_users`.

Server paths in this project are exactly (PRD B1/B2, W5):

| Use client path when…                      | Use server path when…                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| **All reads** (readings, charts, devices)  | Device ingest `POST /api/v1/readings` (HMAC verify)   |
| **All user-scoped writes** RLS can enforce | Device registration / sharing (`device_users` writes) |
| Realtime subscriptions (dashboard)         | Telegram account linking, account settings            |
| Paginated/filtered history queries         | CSV export (server action)                            |

The `devices.secret` column (HMAC keys) is **service-role only** — no RLS
policy may ever expose it to any user path.

## Supabase Clients — which one, where

| Context                     | Client                                             | Key                                     | RLS          |
| --------------------------- | -------------------------------------------------- | --------------------------------------- | ------------ |
| Browser (hooks)             | `useSupabaseClient()`                              | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  | Enforced     |
| Server actions / API routes | `createServiceRoleClient()` from `@ws/supabase-db` | `SUPABASE_SECRET_KEY`                   | **Bypassed** |
| Edge function (bot)         | service-role client created in-function            | `SUPABASE_SECRET_KEY` (function secret) | **Bypassed** |

### RLS Auth Flow (Clerk → Supabase)

Clerk is the only web auth (no Supabase Auth). The browser client attaches the
Clerk session token so Postgres RLS can read the user identity:

```typescript
// lib/supabase.ts — canonical browser client hook
'use client'

import { useSession } from '@clerk/nextjs'
import { createClient } from '@supabase/supabase-js'
import { useMemo } from 'react'

import type { Database } from '@ws/supabase-db'

export const useSupabaseClient = () => {
  const { session } = useSession()

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { accessToken: async () => (await session?.getToken()) ?? null },
      ),
    [session],
  )
}
```

The Telegram bot authenticates users by Telegram ID (taken from the incoming
update, never user-supplied) and uses the service-role client — so it must
check `device_users` membership explicitly in code for every query, exactly
like a server action.

---

## Services Layer (Database Services)

Services are **pure async functions** with no React code. They accept a
Supabase client as the first parameter, perform database operations, and
return typed data.

- **File pattern**: `apps/web/src/services/{domain}/{domain}.service.ts`
- First parameter is always `supabase: SupabaseClient<Database>` — the same
  service works on both paths because the caller injects the client
- Always use `async` arrow functions
- Throw `ServiceError` (never generic `Error`) with code and details
- Handle `PGRST116` (no rows) explicitly when using `.single()`
- Use `.maybeSingle()` when null is an expected result
- Convert dates to ISO strings for inserts: `new Date().toISOString()`

### ServiceError (REQUIRED)

```typescript
// services/database/types.ts
export class ServiceError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}
```

### Service Example

```typescript
// services/readings/readings.service.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export const fetchLatestReading = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<Reading | null> => {
  const { data, error } = await supabase
    .from('readings')
    .select(
      'id, deviceId:device_id, timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation',
    )
    .eq('device_id', params.deviceId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch latest reading: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data
}
```

### Column Aliasing (REQUIRED)

Always alias snake_case columns to camelCase in `.select()` — never transform
rows manually:

```typescript
// ✅ alias in the query
.select('createdAt:created_at, deviceId:device_id')

// ❌ manual mapping
data.map((r) => ({ createdAt: r.created_at }))
```

- Filter/sort columns (`.eq()`, `.order()`) stay snake_case
- Insert/update payloads use snake_case column names
- Nested selects support aliasing: `device_users ( userId:user_id, role )`

### Query Best Practices

1. Always import `Database`/row types from `@ws/supabase-db`, domain types from `@ws/shared`
2. Always specify columns in `.select()`; never `select('*')` on `readings`
   (it is the big table — 5-minute resolution × 12 months)
3. Range queries on readings must filter on `device_id` + `timestamp` — the
   `(device_id, timestamp DESC)` index exists for exactly this
4. Leverage `readings_daily` for anything longer than the 30-day chart window
5. All modules using secret keys must `import 'server-only'` as their first
   import to prevent accidental client-side bundling

---

## Client Actions (Hooks) — DEFAULT data path

Client actions wrap TanStack Query hooks with automatic Supabase client
injection. **Always use client actions for data fetching and user-scoped
mutations.**

- **File pattern**: `apps/web/src/services/{domain}/{domain}.queries.ts`
- Use `useSupabaseClient()` — publishable key, RLS-protected
- Always set `enabled` condition to prevent premature queries
- Invalidate parent keys on mutation success to trigger refetch
- Default stale time: 60 seconds (configured in QueryProvider)

### Query Key Factory (per domain)

```typescript
// services/readings/readings.queries.ts
export const readingKeys = {
  all: ['readings'] as const,
  latest: (deviceId: string) =>
    [...readingKeys.all, 'latest', deviceId] as const,
  history: (deviceId: string, range: '24h' | '7d' | '30d') =>
    [...readingKeys.all, 'history', deviceId, range] as const,
}
```

- Root key is always `['domain']`; params go into array elements
- Use `as const` for type safety
- Invalidating a prefix invalidates all descendant keys

### Query Hook Example

```typescript
export const useLatestReadingQuery = (deviceId: string | undefined) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: readingKeys.latest(deviceId ?? ''),
    queryFn: () => fetchLatestReading(client, { deviceId: deviceId! }),
    enabled: !!deviceId,
  })
}
```

### Page Loading States (REQUIRED)

Every page that fetches data MUST show a skeleton while loading — never flash
empty-state content while queries are pending.

**Critical:** TanStack Query's `isLoading` is `false` while a query is
disabled. Clerk's `useUser()` starts with `isLoaded: false`, so queries gated
on `enabled: !!user` are disabled initially — you **must** also check Clerk's
`isLoaded`:

```typescript
const { user, isLoaded: isUserLoaded } = useUser()
const { data, isLoading } = useLatestReadingQuery(deviceId)

if (!isUserLoaded || isLoading) {
  return <SkeletonUI />
}
```

---

## Server Actions — ONLY for sensitive operations

Server actions use the **service-role** client (bypasses RLS) with Clerk
`auth()` for authorization. In this project that means: device registration,
device sharing, Telegram linking, account settings, CSV export (PRD B2, W5).

- **File pattern**: `apps/web/src/actions/{domain}.action.ts`
- Always start with `'use server'`; `import 'server-only'` first in any module
  touching `SUPABASE_SECRET_KEY`
- Call `auth()` from `@clerk/nextjs/server` for user context
- **Check ownership explicitly** — RLS is bypassed; join through `device_users`
  in code before touching device-scoped rows
- Use `createServiceRoleClient()` from `@ws/supabase-db`, never the anon client
- Validate all inputs before database operations

```typescript
// actions/devices.action.ts
'use server'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'

export const registerDeviceAction = async (params: { deviceId: string }) => {
  const { userId } = await auth()
  if (!userId) throw new Error('Unauthorized')
  if (!params.deviceId?.trim()) throw new Error('deviceId is required')

  const serviceClient = createServiceRoleClient()
  // 1. verify device exists + status is 'unregistered'
  // 2. insert into device_users with role 'owner'; flip devices.status
}
```

### Device Ingest (API route — the other server path)

`POST /api/v1/readings` (`app/api/v1/readings/route.ts`) validates the
`x-device-id` header against `devices`, recomputes the HMAC-SHA256 signature
over body + `x-timestamp` with the stored secret, rejects outside the
`REPLAY_WINDOW_MS` window (constants in `@ws/shared`), and inserts with the
service-role client. Devices have **write-only** access — never return data
to a device.

### API Versioning — two axes, never conflated

| Axis             | Lives in               | Format                  | Bumps when                               |
| ---------------- | ---------------------- | ----------------------- | ---------------------------------------- |
| **Path version** | `/api/v1/…`            | major only — `v1`, `v2` | a **breaking** contract change           |
| **Spec version** | OpenAPI `info.version` | full semver — `1.0.1`   | **any** change to that version's surface |

**Never put semver in the path.** Each device holds its own full ingest URL in
NVS (falling back to the flash-time `API_URL` build flag), so a path that moved
on a patch release would strand every deployed device until it was repointed
one at a time — by reflashing, or by hand through its LAN setup portal. There is
no fleet-wide URL push. A backwards-compatible change to v1 bumps `specVersion`
in `API_VERSION_META` and leaves `/api/v1` alone.

- `API_VERSIONS` / `LATEST_API_VERSION` / `readingsIngestPath(version)` live in
  `@ws/shared`. There is deliberately **no** unversioned path constant — every
  caller names its version, so no constant bump can repoint a pinned device.
- `buildOpenApiDocument(version)` builds one document per version.
  `PATH_REGISTRARS` maps each version to its own `registerVxPaths` function;
  **a shipped registrar is never edited** for a breaking change — add a new one.
- Docs live at `/api/{version}/reference`, beside the spec they document, so they
  retire with their version. Each page renders a Scalar `sources` dropdown over
  all of `API_VERSIONS`, so any docs URL can reach any version. `/api-docs`
  308-redirects to `LATEST_API_VERSION`.
- **A route folder is not a version.** Adding `app/api/v2/<endpoint>/route.ts`
  gives a working endpoint but no docs — versions are registered in code, not
  discovered from the filesystem. `tests/unit/app/api/versions.test.ts` fails on
  that drift rather than letting `/api/v2/reference` 404 unexplained.
- `status` is `current` (exactly one, always `LATEST_API_VERSION`), `preview`
  (served and documented, not yet the recommended target), or `deprecated`
  (still served, carries a `sunset`).

Use the `/new-api-version` skill when adding one — it carries the full
checklist.

---

## Database Rules (Supabase / Postgres)

### Migrations

- Files use **UTC timestamp format**: `YYYYMMDDHHmmss_<name>.sql`
  (create via `yarn migrate:new <name>`)
- **Always run `yarn regenerate:types` after any migration** so
  `src/types/database.ts` stays in sync
- Add RLS policies + required indexes in the same migration as the table

### Performance (every new table, view, function, policy)

- **Function volatility**: RLS helper functions must be `STABLE`; never leave
  functions `VOLATILE` (the default) unless they genuinely modify state
- **RLS policies**: no per-row function calls — wrap every helper call as
  `(select public.fn())` to force a single InitPlan per query. `STABLE` only
  _permits_ once-per-statement evaluation and never forces it for
  `SECURITY DEFINER` helpers, so the `(select …)` wrap is required, not
  optional (Supabase lint `0003_auth_rls_initplan`). `auth.uid()` is likewise
  evaluated once per query only when wrapped this way
- **Nullable comparisons** in RLS: `IS DISTINCT FROM`, never `!=`/`<>`
- **Views**: avoid CTEs over `readings` (optimization fences); prefer
  denormalized latest-value columns kept current by `AFTER INSERT` triggers
- **Required indexes**: `(device_id, timestamp DESC)` on readings-style
  tables; btree on every FK column; `(user_id)` for RLS equality checks

### pgTAP Tests

RLS tests live in `infra/supabase-db/supabase/tests/*.sql` and run with
`yarn test:db`. Rules: assertions via `SELECT ok(...)` (never `PERFORM` in
`DO` blocks — output is discarded); test all rows, not samples; every new
table with RLS policies gets a pgTAP test proving user A cannot read user B's
rows (PRD success metric).

---

## TypeScript Hard Rules

- **NEVER use `any`** (including `as any`, `any[]`, `Record<string, any>`) —
  prefer `unknown` + narrowing, generics, proper interfaces
- **NEVER use `eslint-disable`** or any ESLint comment to bypass rules; if
  lint complains, refactor until it passes
- **Arrow functions only** — `const fn = () => {}`; no `function` declarations
  (ESLint `func-style: ["error", "expression"]`)
- **`const` over `let`** for variables never reassigned
- **Type/value import separation** — `import type { X }` separate from value
  imports; barrel files separate `export type { … }` from `export { … }`
- **`ReactElement`/`ReactNode`** via named import — never `JSX.Element`
- **`testId` prop** on every component (`data-testid`, kebab-case)

### React Performance

- **`useCallback`** — wrap every function defined inside a component; no
  inline anonymous functions in JSX
- **`useMemo`** — wrap derived values, computed arrays/objects, `.map()`,
  `.filter()`, and literals passed as props
- **`memo()`** — only when profiling shows re-render issues; measure first

---

## Testing Strategy

| Layer       | Tool                       | Location                            | Scope                           |
| ----------- | -------------------------- | ----------------------------------- | ------------------------------- |
| Unit        | Jest                       | `tests/unit/` (mirrors `src/`)      | hooks, utils, services (mocked) |
| Integration | Jest + real local Supabase | `tests/integration/`                | DB services — no DB mocking     |
| DB          | pgTAP                      | `infra/supabase-db/supabase/tests/` | RLS, schema, triggers           |

- **NEVER place test files next to source files** — tests live in the
  workspace's `tests/` folder, mirroring `src/`
- Unit tests import source via the `@/` alias
- Every service file gets an integration test (two clients: service-role for
  setup/teardown, test client for assertions; clean up in `afterEach`; cover
  CRUD, error paths, and RLS enforcement)
- Script names: `test:unit`, `test:integration`, `test:db` — no other names

---

## Workflow

- Run `yarn lint` and `yarn check-types` before completing any task; run
  `yarn format` before committing (CI enforces `format:check`)
- Hold off on commits until functionality is fully implemented and tested
- When fixing bugs, add comments explaining the original issue and the fix
- Always write tests when adding services, hooks, or migrations (unit +
  integration + pgTAP for RLS tables)

## Adding a New Feature (Step-by-Step)

1. **Migration** — `yarn migrate:new <name>`; table + indexes + RLS policies
2. **Regenerate types** — `yarn regenerate:types` (from `infra/supabase-db/`)
3. **Shared types** — domain types/constants go in `packages/shared`
4. **Service function** — `services/{domain}/{domain}.service.ts`
5. **Query keys + client action hook** — `services/{domain}/{domain}.queries.ts`
   — **this is the default data path**
6. **Server action** (only if it needs secrets/elevation) —
   `actions/{domain}.action.ts`
7. **Component** — use the hook; skeleton loading state required
8. **Tests** — unit + integration + pgTAP as applicable
9. **Verify** — `yarn lint && yarn check-types && yarn test:unit && yarn build`

## Claude Code Harness

Team-shared agent config lives in `.claude/` (committed):

- **Hooks**: every Edit/Write is auto-formatted with prettier; edits to
  `.env*` / `firmware/secrets.ini` are blocked (templates `.env.example` /
  `secrets.ini.example` stay editable)
- **Skills**: `/verify` (area-specific end-to-end verification),
  `/new-migration` (Supabase migration workflow)
- **Agents**: `rls-reviewer` (run after any migration/RLS change),
  `data-path-reviewer` (run after web data features)
- **`.mcp.json`**: ships the context7 docs-lookup server for the whole team

Personal overrides belong in `.claude/settings.local.json` (gitignored).

## Environment Variables

| Variable                               | Scope         | Description                                         |
| -------------------------------------- | ------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`    | Client        | Clerk publishable key                               |
| `CLERK_SECRET_KEY`                     | Server        | Clerk secret key                                    |
| `NEXT_PUBLIC_SUPABASE_URL`             | Client        | Supabase API URL                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client        | Supabase publishable key (RLS)                      |
| `SUPABASE_URL`                         | Server        | Supabase API URL                                    |
| `SUPABASE_SECRET_KEY`                  | Server        | Service-role key — **bypasses RLS**                 |
| `BOT_TOKEN`                            | Edge function | Telegram bot token                                  |
| `BOT_WEBHOOK_SECRET`                   | Edge function | Telegram webhook secret token                       |
| `API_DOCS_ENABLED`                     | Server        | Force OpenAPI/Scalar docs on/off (auto-off in prod) |

Secrets are managed with **Infisical**: inject them at runtime with
`infisical run -- <command>` (e.g. `infisical run -- yarn workspace @ws/web dev`).
The repo links to the Infisical project via a gitignored `.infisical.json` —
run `infisical login` + `infisical init` once. The `test:integration:secrets`
script already wraps the integration test this way. A local `.env`/`.env.local`
(gitignored) still works as a fallback; document new variables in the matching
`.env.example` without values. Edge function secrets are set via
`npx supabase secrets set`.

### Local Supabase Ports

| Service  | Port  |
| -------- | ----- |
| API      | 54321 |
| Database | 54322 |
| Studio   | 54323 |
