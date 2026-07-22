# MRP-12 — Readings Ingest API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `POST /api/v1/readings` — the HMAC-signed, replay-protected, service-role write path from device to database — plus a liveness health route and zod-derived OpenAPI/Swagger docs, all under a `v1` prefix.

**Architecture:** A thin Next.js App Router route handler orchestrates pure helpers (HMAC verify, zod payload validation) and a services-layer function that inserts via the service-role client with `ON CONFLICT DO NOTHING`. The OpenAPI document is generated from the same zod schema used for validation, so docs can't drift. Docs are disabled in production.

**Tech Stack:** Next.js 16 App Router, TypeScript, `node:crypto`, zod 3, `@asteasolutions/zod-to-openapi`, `@scalar/nextjs-api-reference` (docs UI — swapped from swagger-ui-react during implementation, see Amendments), `@supabase/supabase-js`, Jest + ts-jest, Supabase (Postgres).

## Global Constraints

- **No migration, no RLS policy** — `readings` already exists with the `(device_id, timestamp desc)` unique index and `service_role` already has `grant all`. Do not add DB schema.
- **TypeScript hard rules (CLAUDE.md):** never `any` / `as any`; never `eslint-disable`; **arrow functions only** (`const fn = () => {}`); `const` over `let`; `import type` separated from value imports; `ReactElement`/`ReactNode` via named import (never `JSX.Element`); every React component takes a kebab-case `testId` prop rendered as `data-testid`.
- **Services (CLAUDE.md):** pure async arrow functions; first param is always `supabase: SupabaseClient<Database>`; throw `ServiceError` (never generic `Error`); alias snake_case→camelCase in `.select()`; insert payloads use snake_case columns; `.maybeSingle()` when null is expected.
- **Tests live in `tests/`** mirroring `src/`, never beside source. Import source via the `@/` alias.
- **Version pins:** `zod@^3.23.8`, `@asteasolutions/zod-to-openapi@^7.3.0`, `@supabase/supabase-js@^2.49.4`, `swagger-ui-react@^5.17.14`, `@types/swagger-ui-react@^5.17.4`.
- **HMAC contract:** key = device secret used **as-is** (64-char hex string as UTF-8 text); signed message = `` `${xTimestamp}.${rawBody}` ``; signature = lowercase hex; replay window = `REPLAY_WINDOW_MS` (300 000 ms) against `x-timestamp` (epoch-ms send time).
- **Commits:** message prefix `MRP-12:`; end each commit message with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Commit only at the end of each task (repo commits only deliberately).
- **Run commands** from the repo root. Single test file: `yarn workspace @ws/web jest --selectProjects=unit <path>`.

---

### Task 1: Setup — dependencies, jest projects, shared constants

**Files:**
- Modify: `apps/web/package.json` (deps + `test:integration` script)
- Modify: `apps/web/jest.config.mjs` (add `integration` project + `server-only` stub mapping)
- Create: `apps/web/tests/stubs/server-only.ts`
- Modify: `packages/shared/src/constants/index.ts` (append constants)

**Interfaces:**
- Produces: `API_VERSION: 'v1'`, `READINGS_INGEST_PATH: string`, `SENSOR_BOUNDS` (below) from `@ws/shared`.

- [ ] **Step 1: Add dependencies**

Edit `apps/web/package.json`. Under `"dependencies"` add:

```json
"@asteasolutions/zod-to-openapi": "^7.3.0",
"@supabase/supabase-js": "^2.49.4",
"swagger-ui-react": "^5.17.14",
"zod": "^3.23.8"
```

Under `"devDependencies"` add:

```json
"@types/swagger-ui-react": "^5.17.4"
```

Under `"scripts"` add:

```json
"test:integration": "jest --selectProjects=integration --ci --runInBand"
```

- [ ] **Step 2: Install**

Run: `yarn install`
Expected: completes; lockfile updates. Peer-dependency **warnings** from `swagger-ui-react` about React 19 are acceptable (not errors).

- [ ] **Step 3: Add the `server-only` test stub**

Create `apps/web/tests/stubs/server-only.ts`:

```ts
// Stub for the `server-only` package under Jest. The real module throws when
// imported outside a React Server Component graph; route modules import it, so
// tests map it here to a harmless empty module.
export {}
```

- [ ] **Step 4: Wire the integration project and server-only mapping into Jest**

Replace `apps/web/jest.config.mjs` with:

```js
/** @type {import('jest').Config} */
const tsProject = (displayName, dir) => ({
  displayName,
  testMatch: [`<rootDir>/tests/${dir}/**/*.test.{ts,tsx}`],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', verbatimModuleSyntax: false } },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/tests/stubs/server-only.ts',
  },
})

const config = {
  projects: [tsProject('unit', 'unit'), tsProject('integration', 'integration')],
}

export default config
```

- [ ] **Step 5: Append shared constants**

Append to `packages/shared/src/constants/index.ts`:

```ts
/** API version prefix for the device-facing HTTP surface (PRD B1). */
export const API_VERSION = 'v1'

/**
 * Fully-qualified ingest path. Single source of truth for the route handler,
 * the OpenAPI `servers` block, and the firmware upload URL (MRP-15) — keep
 * firmware config in sync when this changes.
 */
export const READINGS_INGEST_PATH = `/api/${API_VERSION}/readings`

/**
 * Plausible physical ranges for sensor values (PRD B1 basic validation).
 * Inclusive bounds; readings outside these are rejected with HTTP 400.
 */
export const SENSOR_BOUNDS = {
  temperature: { min: -90, max: 60 }, // °C
  humidity: { min: 0, max: 100 }, // % relative humidity
  pressure: { min: 300, max: 1100 }, // hPa (BME280 operating range)
  windSpeed: { min: 0, max: 120 }, // km/h
  windDirection: { min: 0, max: 360 }, // degrees
  precipitation: { min: 0, max: 500 }, // mm
} as const
```

- [ ] **Step 6: Verify types compile**

Run: `yarn workspace @ws/shared check-types && yarn workspace @ws/web check-types`
Expected: PASS (no output / exit 0). `@ws/web` still has no new source, so this only confirms the deps resolve.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/jest.config.mjs apps/web/tests/stubs/server-only.ts packages/shared/src/constants/index.ts yarn.lock
git commit -m "MRP-12: add ingest deps, integration jest project, shared ingest constants"
```

---

### Task 2: HMAC signature verification (pure)

**Files:**
- Create: `apps/web/src/lib/ingest/verify-signature.ts`
- Test: `apps/web/tests/unit/lib/ingest/verify-signature.test.ts`

**Interfaces:**
- Produces: `verifySignature(params: { secret: string; timestamp: string; rawBody: string; signature: string }): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/lib/ingest/verify-signature.test.ts`:

```ts
import { createHmac } from 'node:crypto'

import { verifySignature } from '@/lib/ingest/verify-signature'

const SECRET = 'a'.repeat(64)
const TIMESTAMP = '1721563200000'
const BODY = '{"temperature":21.4}'

const sign = (secret: string, timestamp: string, rawBody: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    const signature = sign(SECRET, TIMESTAMP, BODY)
    expect(
      verifySignature({ secret: SECRET, timestamp: TIMESTAMP, rawBody: BODY, signature }),
    ).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = sign(SECRET, TIMESTAMP, BODY)
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: '{"temperature":99}',
        signature,
      }),
    ).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const signature = sign('b'.repeat(64), TIMESTAMP, BODY)
    expect(
      verifySignature({ secret: SECRET, timestamp: TIMESTAMP, rawBody: BODY, signature }),
    ).toBe(false)
  })

  it('rejects malformed (non-hex) signatures without throwing', () => {
    expect(
      verifySignature({ secret: SECRET, timestamp: TIMESTAMP, rawBody: BODY, signature: 'zz' }),
    ).toBe(false)
  })

  it('rejects a wrong-length signature', () => {
    expect(
      verifySignature({ secret: SECRET, timestamp: TIMESTAMP, rawBody: BODY, signature: 'ab' }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/ingest/verify-signature.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/verify-signature`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/ingest/verify-signature.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify an HMAC-SHA256 signature over `${timestamp}.${rawBody}` (MRP-12
 * contract). The key is the device secret used as-is — the 64-char hex string
 * as UTF-8 text, NOT decoded to bytes — matching the firmware signer (MRP-15).
 * The provided signature is lowercase hex.
 *
 * Comparison is constant-time. Returns false — never throws — on a malformed
 * or wrong-length signature (`Buffer.from(_, 'hex')` truncates invalid hex, so
 * a length mismatch catches it) so the caller can treat every failure as one
 * generic 401.
 */
export const verifySignature = (params: {
  secret: string
  timestamp: string
  rawBody: string
  signature: string
}): boolean => {
  const expected = createHmac('sha256', params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest()
  const provided = Buffer.from(params.signature, 'hex')

  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/ingest/verify-signature.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ingest/verify-signature.ts apps/web/tests/unit/lib/ingest/verify-signature.test.ts
git commit -m "MRP-12: add constant-time HMAC signature verification"
```

---

### Task 3: Sensor payload validation (zod)

**Files:**
- Create: `apps/web/src/lib/ingest/reading-schema.ts`
- Test: `apps/web/tests/unit/lib/ingest/reading-schema.test.ts`

**Interfaces:**
- Consumes: `SENSOR_BOUNDS` from `@ws/shared`.
- Produces:
  - `readingSchema` (a zod object schema)
  - `parseReadingPayload(input: unknown): { ok: true; data: ReadingPayload } | { ok: false; issues: z.ZodIssue[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/lib/ingest/reading-schema.test.ts`:

```ts
import { parseReadingPayload } from '@/lib/ingest/reading-schema'

const valid = {
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 21.4,
  humidity: 55,
  pressure: 1013.2,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
}

describe('parseReadingPayload', () => {
  it('accepts a valid payload', () => {
    const result = parseReadingPayload(valid)
    expect(result.ok).toBe(true)
  })

  it('accepts null for optional sensor fields', () => {
    const result = parseReadingPayload({ ...valid, windSpeed: null, precipitation: null })
    expect(result.ok).toBe(true)
  })

  it('accepts populated optional sensor fields within range', () => {
    const result = parseReadingPayload({
      ...valid,
      windSpeed: 12,
      windDirection: 180,
      precipitation: 3,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects out-of-range temperature', () => {
    const result = parseReadingPayload({ ...valid, temperature: 999 })
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-range humidity', () => {
    const result = parseReadingPayload({ ...valid, humidity: 150 })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing required field', () => {
    const { humidity: _omit, ...missing } = valid
    const result = parseReadingPayload(missing)
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong-typed field', () => {
    const result = parseReadingPayload({ ...valid, temperature: 'hot' })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-ISO timestamp', () => {
    const result = parseReadingPayload({ ...valid, timestamp: 'yesterday' })
    expect(result.ok).toBe(false)
  })

  it('strips unknown extra fields', () => {
    const result = parseReadingPayload({ ...valid, extra: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect('extra' in result.data).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/ingest/reading-schema.test.ts`
Expected: FAIL — cannot find module `@/lib/ingest/reading-schema`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/ingest/reading-schema.ts`:

```ts
import { SENSOR_BOUNDS } from '@ws/shared'
import type { ReadingPayload } from '@ws/shared'
import { z } from 'zod'

const bounded = (b: { min: number; max: number }) =>
  z.number().finite().min(b.min).max(b.max)

/** Validation source of truth; also feeds the OpenAPI document (Task 7). */
export const readingSchema = z.object({
  timestamp: z.string().datetime(),
  temperature: bounded(SENSOR_BOUNDS.temperature),
  humidity: bounded(SENSOR_BOUNDS.humidity),
  pressure: bounded(SENSOR_BOUNDS.pressure),
  windSpeed: bounded(SENSOR_BOUNDS.windSpeed).nullable(),
  windDirection: bounded(SENSOR_BOUNDS.windDirection).nullable(),
  precipitation: bounded(SENSOR_BOUNDS.precipitation).nullable(),
})

export type ReadingParseResult =
  | { ok: true; data: ReadingPayload }
  | { ok: false; issues: z.ZodIssue[] }

export const parseReadingPayload = (input: unknown): ReadingParseResult => {
  const result = readingSchema.safeParse(input)
  if (!result.success) return { ok: false, issues: result.error.issues }
  return { ok: true, data: result.data }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/ingest/reading-schema.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/ingest/reading-schema.ts apps/web/tests/unit/lib/ingest/reading-schema.test.ts
git commit -m "MRP-12: add zod sensor-payload validation"
```

---

### Task 4: Readings service (`ServiceError`, `fetchDeviceSecret`, `insertReading`) + integration test

**Files:**
- Create: `apps/web/src/services/database/types.ts`
- Create: `apps/web/src/services/readings/readings.service.ts`
- Test: `apps/web/tests/integration/services/readings/readings.service.integration.test.ts`

**Interfaces:**
- Consumes: `SupabaseClient<Database>`, `ReadingPayload` from `@ws/shared`, `Database` from `@ws/supabase-db`.
- Produces:
  - `class ServiceError extends Error` with `code?: string`, `details?: unknown`
  - `fetchDeviceSecret(supabase, params: { deviceId: string }): Promise<string | null>`
  - `insertReading(supabase, params: { deviceId: string; payload: ReadingPayload }): Promise<void>`

**Prerequisite:** local Supabase running. From `infra/supabase-db/`: `yarn db-reset:local`. Then export the local service-role credentials printed by `npx supabase status`:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SECRET_KEY=<service_role key from `npx supabase status`>
```

- [ ] **Step 1: Write the failing integration test**

Create `apps/web/tests/integration/services/readings/readings.service.integration.test.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchDeviceSecret, insertReading } from '@/services/readings/readings.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY

const DEVICE_ID = 'ws-inttest-readings'
const SECRET = 'b'.repeat(64)
const payload = {
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 20,
  humidity: 50,
  pressure: 1000,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
}

// Own client built inline (not createServiceRoleClient) so the test avoids the
// `server-only` import; this is the service-role key, so it bypasses RLS.
const db = createClient<Database>(url ?? '', key ?? '')

const seedDevice = async () => {
  const { error } = await db
    .from('devices')
    .insert({ device_id: DEVICE_ID, secret: SECRET, status: 'unregistered' })
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
  // FK on delete cascade removes the device's readings too.
  await db.from('devices').delete().eq('device_id', DEVICE_ID)
})

describe('readings service (integration)', () => {
  it('fetchDeviceSecret returns the secret for a known device, null for unknown', async () => {
    await seedDevice()
    expect(await fetchDeviceSecret(db, { deviceId: DEVICE_ID })).toBe(SECRET)
    expect(await fetchDeviceSecret(db, { deviceId: 'ws-does-not-exist' })).toBeNull()
  })

  it('insertReading writes one row and treats a duplicate timestamp as a no-op', async () => {
    await seedDevice()
    await insertReading(db, { deviceId: DEVICE_ID, payload })
    await insertReading(db, { deviceId: DEVICE_ID, payload }) // retry of same reading

    const { count } = await db
      .from('readings')
      .select('*', { count: 'exact', head: true })
      .eq('device_id', DEVICE_ID)
    expect(count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ws/web jest --selectProjects=integration tests/integration/services/readings/readings.service.integration.test.ts`
Expected: FAIL — cannot find module `@/services/readings/readings.service`.

- [ ] **Step 3: Write `ServiceError`**

Create `apps/web/src/services/database/types.ts`:

```ts
/** Thrown by every service function instead of a generic Error (CLAUDE.md). */
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

- [ ] **Step 4: Write the service**

Create `apps/web/src/services/readings/readings.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadingPayload } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

/**
 * Read a device's HMAC secret. Service-role only — `devices.secret` is never
 * exposed to any user path. No `status` filter: a flashed device ingests
 * before a user claims it (`unregistered`), which is expected.
 */
export const fetchDeviceSecret = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('devices')
    .select('secret')
    .eq('device_id', params.deviceId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch device secret: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data?.secret ?? null
}

/**
 * Insert a reading (insert-only path). Uses ON CONFLICT DO NOTHING on the
 * `(device_id, timestamp)` unique index so a firmware retry of an
 * already-ingested reading is a silent success, not a 409 that would burn the
 * device's attempts (see migration comment on `readings_device_id_timestamp_idx`).
 */
export const insertReading = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; payload: ReadingPayload },
): Promise<void> => {
  const { payload } = params
  const { error } = await supabase.from('readings').upsert(
    {
      device_id: params.deviceId,
      timestamp: payload.timestamp,
      temperature: payload.temperature,
      humidity: payload.humidity,
      pressure: payload.pressure,
      wind_speed: payload.windSpeed,
      wind_direction: payload.windDirection,
      precipitation: payload.precipitation,
    },
    { onConflict: 'device_id,timestamp', ignoreDuplicates: true },
  )

  if (error) {
    throw new ServiceError(
      `Failed to insert reading: ${error.message}`,
      error.code,
      error.details,
    )
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ws/web jest --selectProjects=integration tests/integration/services/readings/readings.service.integration.test.ts`
Expected: PASS (2 tests). If it errors on connection, confirm local Supabase is up and the env vars are exported.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/services apps/web/tests/integration
git commit -m "MRP-12: add readings service (fetchDeviceSecret, insertReading) + integration test"
```

---

### Task 5: `POST /api/v1/readings` route + unit tests

**Files:**
- Create: `apps/web/src/app/api/v1/readings/route.ts`
- Test: `apps/web/tests/unit/app/api/v1/readings/route.test.ts`

**Interfaces:**
- Consumes: `verifySignature` (Task 2), `parseReadingPayload` (Task 3), `fetchDeviceSecret`/`insertReading` (Task 4), `createServiceRoleClient` from `@ws/supabase-db`, header/window constants from `@ws/shared`.
- Produces: `POST(request: Request): Promise<Response>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/app/api/v1/readings/route.test.ts`:

```ts
import { createHmac } from 'node:crypto'

import { DEVICE_ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '@ws/shared'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'client' })),
}))
jest.mock('@/services/readings/readings.service', () => ({
  fetchDeviceSecret: jest.fn(),
  insertReading: jest.fn(),
}))

import { fetchDeviceSecret, insertReading } from '@/services/readings/readings.service'
import { POST } from '@/app/api/v1/readings/route'

const mockFetchSecret = fetchDeviceSecret as jest.MockedFunction<typeof fetchDeviceSecret>
const mockInsert = insertReading as jest.MockedFunction<typeof insertReading>

const SECRET = 'a'.repeat(64)
const NOW = 1_721_563_200_000
const DEVICE_ID = 'ws-test'

const validBody = JSON.stringify({
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 21.4,
  humidity: 55,
  pressure: 1013.2,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})

const sign = (timestamp: string, body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

const makeRequest = (opts: {
  deviceId?: string | null
  timestamp?: string | null
  signature?: string | null
  body?: string
}): Request => {
  const timestamp = opts.timestamp === undefined ? String(NOW) : opts.timestamp
  const body = opts.body ?? validBody
  const signature =
    opts.signature === undefined ? sign(timestamp ?? '', body) : opts.signature
  const headers = new Headers()
  const deviceId = opts.deviceId === undefined ? DEVICE_ID : opts.deviceId
  if (deviceId !== null) headers.set(DEVICE_ID_HEADER, deviceId)
  if (timestamp !== null) headers.set(TIMESTAMP_HEADER, timestamp)
  if (signature !== null) headers.set(SIGNATURE_HEADER, signature)
  return new Request('http://localhost/api/v1/readings', { method: 'POST', headers, body })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockFetchSecret.mockResolvedValue(SECRET)
  mockInsert.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('POST /api/v1/readings', () => {
  it('accepts a valid signed reading (201) and inserts it', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert.mock.calls[0][1]).toMatchObject({ deviceId: DEVICE_ID })
  })

  it('returns 401 for an unknown device', async () => {
    mockFetchSecret.mockResolvedValue(null)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 401 for a bad signature', async () => {
    const res = await POST(makeRequest({ signature: 'deadbeef' }))
    expect(res.status).toBe(401)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 401 for a stale/replayed timestamp before any DB lookup', async () => {
    const stale = String(NOW - 400_000)
    const res = await POST(makeRequest({ timestamp: stale }))
    expect(res.status).toBe(401)
    expect(mockFetchSecret).not.toHaveBeenCalled()
  })

  it('returns 401 when a required header is missing', async () => {
    const res = await POST(makeRequest({ signature: null }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an out-of-range sensor value', async () => {
    const body = JSON.stringify({
      timestamp: '2026-07-21T12:00:00.000Z',
      temperature: 999,
      humidity: 55,
      pressure: 1013.2,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    })
    const res = await POST(makeRequest({ body, signature: sign(String(NOW), body) }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_payload' })
  })

  it('returns 400 for a non-JSON body', async () => {
    const body = 'not json'
    const res = await POST(makeRequest({ body, signature: sign(String(NOW), body) }))
    expect(res.status).toBe(400)
  })

  it('still returns 201 when the insert is a duplicate no-op', async () => {
    mockInsert.mockResolvedValue(undefined) // service swallows conflicts
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(201)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/app/api/v1/readings/route.test.ts`
Expected: FAIL — cannot find module `@/app/api/v1/readings/route`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/api/v1/readings/route.ts`:

```ts
import 'server-only'

import {
  DEVICE_ID_HEADER,
  REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import { parseReadingPayload } from '@/lib/ingest/reading-schema'
import { verifySignature } from '@/lib/ingest/verify-signature'
import { fetchDeviceSecret, insertReading } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Unknown device, bad signature, stale timestamp, and missing headers all
// return the same opaque 401 — never reveal which check failed, so the endpoint
// can't be used to enumerate valid device ids.
const unauthorized = (): Response =>
  Response.json({ error: 'unauthorized' }, { status: 401 })

const badPayload = (issues: unknown): Response =>
  Response.json({ error: 'invalid_payload', issues }, { status: 400 })

export const POST = async (request: Request): Promise<Response> => {
  const deviceId = request.headers.get(DEVICE_ID_HEADER)
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const signature = request.headers.get(SIGNATURE_HEADER)
  if (!deviceId || !timestamp || !signature) return unauthorized()

  // Freshness first — reject stale/replayed sends before touching the DB.
  const tsMs = Number(timestamp)
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS) {
    return unauthorized()
  }

  const rawBody = await request.text()

  const supabase = createServiceRoleClient()
  const secret = await fetchDeviceSecret(supabase, { deviceId })
  if (!secret) return unauthorized()

  if (!verifySignature({ secret, timestamp, rawBody, signature })) {
    return unauthorized()
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return badPayload([{ message: 'Body is not valid JSON' }])
  }

  const parsed = parseReadingPayload(json)
  if (!parsed.ok) return badPayload(parsed.issues)

  try {
    await insertReading(supabase, { deviceId, payload: parsed.data })
  } catch {
    return Response.json({ error: 'internal_error' }, { status: 500 })
  }

  return Response.json({ ok: true }, { status: 201 })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/app/api/v1/readings/route.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/v1/readings/route.ts apps/web/tests/unit/app/api/v1/readings/route.test.ts
git commit -m "MRP-12: add POST /api/v1/readings ingest route"
```

---

### Task 6: `GET /api/v1/health` route + unit test

**Files:**
- Create: `apps/web/src/app/api/v1/health/route.ts`
- Test: `apps/web/tests/unit/app/api/v1/health/route.test.ts`

**Interfaces:**
- Produces: `GET(): Promise<Response>` returning `{ status: 'ok', uptime: number, timestamp: string }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/app/api/v1/health/route.test.ts`:

```ts
import { GET } from '@/app/api/v1/health/route'

describe('GET /api/v1/health', () => {
  it('returns 200 with a liveness payload', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/app/api/v1/health/route.test.ts`
Expected: FAIL — cannot find module `@/app/api/v1/health/route`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/api/v1/health/route.ts`:

```ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Liveness only — no external calls, so uptime polling never blocks on the DB. */
export const GET = async (): Promise<Response> =>
  Response.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/app/api/v1/health/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/v1/health/route.ts apps/web/tests/unit/app/api/v1/health/route.test.ts
git commit -m "MRP-12: add GET /api/v1/health liveness route"
```

---

### Task 7: OpenAPI document (derived from zod) + `openapi.json` route, non-prod gated

**Files:**
- Create: `apps/web/src/lib/openapi/docs-enabled.ts`
- Create: `apps/web/src/lib/openapi/document.ts`
- Create: `apps/web/src/app/api/v1/openapi.json/route.ts`
- Test: `apps/web/tests/unit/lib/openapi/docs-enabled.test.ts`
- Test: `apps/web/tests/unit/app/api/v1/openapi.json/route.test.ts`
- Modify: `apps/web/.env.example` (document `API_DOCS_ENABLED`)

**Interfaces:**
- Consumes: `readingSchema` (Task 3); header constants + `API_VERSION` from `@ws/shared`.
- Produces:
  - `areDocsEnabled(): boolean`
  - `buildOpenApiDocument(): object` (OpenAPI 3.1 doc with paths `/readings` and `/health`)
  - `GET(): Promise<Response>` — the spec JSON, or 404 in production.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/lib/openapi/docs-enabled.test.ts`:

```ts
import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

describe('areDocsEnabled', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('is enabled locally (VERCEL_ENV unset)', () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('is disabled in production', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(false)
  })

  it('is enabled in preview', () => {
    process.env.VERCEL_ENV = 'preview'
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('honors the API_DOCS_ENABLED override in production', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'true'
    expect(areDocsEnabled()).toBe(true)
  })
})
```

Create `apps/web/tests/unit/app/api/v1/openapi.json/route.test.ts`:

```ts
import { GET } from '@/app/api/v1/openapi.json/route'

describe('GET /api/v1/openapi.json', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('serves the OpenAPI document when docs are enabled', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths['/readings']).toBeDefined()
    expect(doc.paths['/health']).toBeDefined()
    expect(doc.servers[0].url).toBe('/api/v1')
  })

  it('returns 404 in production', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/openapi tests/unit/app/api/v1/openapi.json`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write the docs-enabled gate**

Create `apps/web/src/lib/openapi/docs-enabled.ts`:

```ts
/**
 * API docs (OpenAPI JSON + Swagger UI) are exposed everywhere except
 * production. `VERCEL_ENV` is 'production' | 'preview' | 'development' on Vercel
 * and undefined locally. `API_DOCS_ENABLED=true|false` overrides.
 */
export const areDocsEnabled = (): boolean => {
  const override = process.env.API_DOCS_ENABLED
  if (override === 'true') return true
  if (override === 'false') return false
  return process.env.VERCEL_ENV !== 'production'
}
```

- [ ] **Step 4: Write the OpenAPI document builder**

Create `apps/web/src/lib/openapi/document.ts`:

```ts
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import {
  API_VERSION,
  DEVICE_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'
import { z } from 'zod'

import { readingSchema } from '@/lib/ingest/reading-schema'

// Adds `.openapi()` to zod's prototype (retroactive — applies to readingSchema).
extendZodWithOpenApi(z)

const SIGNING_DESCRIPTION = [
  'HMAC-signed device ingest (write-only).',
  'msg = `${x-timestamp}.${rawBody}`; key = the 64-char hex device secret used',
  'as UTF-8 text; signature = lowercase hex in x-signature.',
  'x-timestamp is epoch-ms send time and must be within 300s of server time.',
].join(' ')

export const buildOpenApiDocument = () => {
  const registry = new OpenAPIRegistry()
  const ReadingPayload = registry.register('ReadingPayload', readingSchema)

  registry.registerPath({
    method: 'post',
    path: '/readings',
    summary: 'Ingest a signed sensor reading',
    description: SIGNING_DESCRIPTION,
    request: {
      headers: z.object({
        [DEVICE_ID_HEADER]: z.string().openapi({ example: 'ws-abc123def456' }),
        [TIMESTAMP_HEADER]: z.string().openapi({ example: '1721563200000' }),
        [SIGNATURE_HEADER]: z.string().openapi({ example: '9f3a...c1' }),
      }),
      body: { content: { 'application/json': { schema: ReadingPayload } } },
    },
    responses: {
      201: { description: 'Reading accepted (or duplicate no-op)' },
      400: { description: 'Malformed or out-of-range payload' },
      401: { description: 'Unknown device, bad signature, or stale timestamp' },
      500: { description: 'Internal error' },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness probe',
    responses: { 200: { description: 'Service is alive' } },
  })

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: { title: 'Weather Station Ingest API', version: '1.0.0' },
    servers: [{ url: `/api/${API_VERSION}` }],
  })
}
```

- [ ] **Step 5: Write the spec route**

Create `apps/web/src/app/api/v1/openapi.json/route.ts`:

```ts
import { buildOpenApiDocument } from '@/lib/openapi/document'
import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  return Response.json(buildOpenApiDocument())
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace @ws/web jest --selectProjects=unit tests/unit/lib/openapi tests/unit/app/api/v1/openapi.json`
Expected: PASS (docs-enabled: 4 tests; openapi route: 2 tests).

- [ ] **Step 7: Document the override env var**

Append to `apps/web/.env.example`:

```
# API docs (OpenAPI + Swagger UI) — auto-off in production. Set to force on/off.
API_DOCS_ENABLED=
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/openapi apps/web/src/app/api/v1/openapi.json apps/web/tests/unit/lib/openapi apps/web/tests/unit/app/api/v1/openapi.json apps/web/.env.example
git commit -m "MRP-12: derive OpenAPI spec from zod, serve at /api/v1/openapi.json (non-prod)"
```

---

### Task 8: Swagger UI page (non-prod gated)

**Files:**
- Create: `apps/web/src/app/api-docs/swagger-ui.client.tsx`
- Create: `apps/web/src/app/api-docs/page.tsx`

**Interfaces:**
- Consumes: `areDocsEnabled` (Task 7); the `/api/v1/openapi.json` route (Task 7).
- Produces: the `/api-docs` page (no exported symbols other than the default page).

This task has no unit test — `swagger-ui-react` is a heavy third-party widget that is impractical to assert in jsdom. It is verified by rendering in the dev server (Step 3).

- [ ] **Step 1: Write the client component**

Create `apps/web/src/app/api-docs/swagger-ui.client.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'

export const SwaggerDocs = ({ testId }: { testId: string }): ReactElement => (
  <div data-testid={testId}>
    <SwaggerUI url="/api/v1/openapi.json" />
  </div>
)
```

- [ ] **Step 2: Write the server page (env-gated)**

Create `apps/web/src/app/api-docs/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import type { ReactElement } from 'react'

import { SwaggerDocs } from './swagger-ui.client'

import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

const ApiDocsPage = (): ReactElement => {
  if (!areDocsEnabled()) notFound()
  return <SwaggerDocs testId="api-docs" />
}

export default ApiDocsPage
```

- [ ] **Step 3: Verify it renders**

Run: `yarn workspace @ws/web dev`
Then open `http://localhost:3000/api-docs`.
Expected: Swagger UI renders with the `POST /readings` and `GET /health` operations. Stop the dev server (Ctrl-C) when confirmed.

**Contingency (React 19 incompatibility):** if the page errors at runtime because `swagger-ui-react` will not mount under React 19, switch to Scalar (the spec's documented fallback): `yarn workspace @ws/web add @scalar/nextjs-api-reference`, delete `swagger-ui.client.tsx`, and replace `page.tsx`'s render with the Scalar handler pointing at `/api/v1/openapi.json`. Keep the same `areDocsEnabled()` gate. Note the swap in the commit message.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api-docs
git commit -m "MRP-12: add Swagger UI at /api-docs (non-prod)"
```

---

### Task 9 (optional): pgTAP hardening — `authenticated` cannot INSERT readings

**Files:**
- Create: `infra/supabase-db/supabase/tests/readings_ingest_grants.test.sql`

This proves the security property behind the service-role-only write path: no user role can write `readings`. Skip if not running the pgTAP suite.

- [ ] **Step 1: Write the pgTAP test**

Create `infra/supabase-db/supabase/tests/readings_ingest_grants.test.sql`:

```sql
begin;
select plan(1);

-- readings has SELECT granted to authenticated but no INSERT grant/policy;
-- only the service-role path writes. Prove authenticated cannot INSERT.
set local role authenticated;
select throws_ok(
  $$ insert into public.readings (device_id, timestamp, temperature, humidity, pressure)
     values ('ws-x', now(), 20, 50, 1000) $$,
  '42501',
  null,
  'authenticated cannot INSERT into readings'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the pgTAP suite**

Run (from `infra/supabase-db/`): `yarn db-reset:local && yarn test:db`
Expected: all tests pass, including `authenticated cannot INSERT into readings`.

- [ ] **Step 3: Commit**

```bash
git add infra/supabase-db/supabase/tests/readings_ingest_grants.test.sql
git commit -m "MRP-12: pgTAP assert authenticated cannot INSERT readings"
```

---

### Task 10: Full verification

**Files:** none (verification + fixups only).

- [ ] **Step 1: Format, lint, types**

Run: `yarn format && yarn lint && yarn check-types`
Expected: all PASS. Fix any issues (never with `eslint-disable`).

- [ ] **Step 2: Full unit suite**

Run: `yarn workspace @ws/web test:unit`
Expected: PASS — verify-signature (5), reading-schema (9), readings route (8), health (1), docs-enabled (4), openapi route (2).

- [ ] **Step 3: Integration suite (local Supabase up, env exported per Task 4)**

Run: `yarn workspace @ws/web test:integration`
Expected: PASS (2 tests).

- [ ] **Step 4: Build**

Run: `yarn workspace @ws/web build`
Expected: build succeeds; `/api/v1/readings`, `/api/v1/health`, `/api/v1/openapi.json`, and `/api-docs` appear in the route output.

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "MRP-12: format/lint fixups after full verification"
```

---

## Self-Review

**Spec coverage:**
- device-id validation, HMAC verify (constant-time), replay window, 401 paths → Tasks 2 & 5. ✅
- Insert one row via service-role, 201, idempotent retry → Task 4 (`insertReading`) + Task 5. ✅
- 400 on malformed/out-of-range → Task 3 + Task 5. ✅
- Unit tests (happy, unknown device, bad signature, replay, malformed) → Task 5. ✅
- Integration test for the service → Task 4. ✅
- Liveness health route → Task 6. ✅
- zod-derived OpenAPI + Swagger UI, non-prod → Tasks 7 & 8. ✅
- `v1` versioning + shared path/version constants → Task 1 + route paths throughout. ✅
- Optional pgTAP hardening → Task 9. ✅
- No migration / no RLS change → honored (Global Constraints). ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step has an expected result. The one contingency (React 19 / Scalar) is a documented library-risk remediation with concrete steps, not a missing-content placeholder. ✅

**Type consistency:** `verifySignature`, `parseReadingPayload`/`ReadingParseResult`, `fetchDeviceSecret`, `insertReading`, `ServiceError`, `areDocsEnabled`, `buildOpenApiDocument`, `SwaggerDocs({ testId })` names and signatures match across the tasks that define and consume them. Header constants (`DEVICE_ID_HEADER`/`TIMESTAMP_HEADER`/`SIGNATURE_HEADER`) and `REPLAY_WINDOW_MS`/`SENSOR_BOUNDS`/`API_VERSION`/`READINGS_INGEST_PATH` come from `@ws/shared`. ✅

---

## Implementation amendments (2026-07-21)

Recorded after execution. Task 8's step-by-step still shows swagger-ui-react
plus its React-19 contingency; the contingency fired and Scalar is what shipped.

- **Task 8 → Scalar (contingency triggered).** swagger-ui-react failed at
  runtime under Turbopack: `OpenApi3_1Element.refract is not a function` (its
  `apidom` OpenAPI-3.1 resolver). Switched to `@scalar/nextjs-api-reference`.
  `/api-docs` is a **gated route handler** (`app/api-docs/route.ts`,
  `export const GET = areDocsEnabled() ? ApiReference({ url })() : 404`) serving
  Scalar's self-contained HTML — no client hydration. Removed
  `app/api-docs/page.tsx` + `swagger-ui.client.tsx`; uninstalled
  `swagger-ui-react` + `@types/swagger-ui-react`; installed
  `@scalar/nextjs-api-reference`.
- **Integration env via Infisical (new).** Added `test:integration:secrets` =
  `infisical run --project-config-dir=../.. -- yarn test:integration` (the
  monorepo `--project-config-dir` points the `apps/web` script at the root
  `.infisical.json`). Pure `test:integration` unchanged for CI.
  `.infisical.json` gitignored; `.env.example` + CLAUDE.md updated.
- **Tests expanded beyond the plan.** +7 route (future / both boundaries /
  non-numeric replay, `x-timestamp` tamper, full-length forgery, 500 branch),
  +1 verify-signature (timestamp binding), +1 integration (value persistence).
  **Final: 37 unit + 3 integration.**
