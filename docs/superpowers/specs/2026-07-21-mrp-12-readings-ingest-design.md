# MRP-12 — `POST /api/v1/readings`: device-id validation, HMAC verification, replay protection

- **Ticket**: [MRP-12](https://linear.app/mrplit/issue/MRP-12) (High, Backend, Phase 1)
- **Branch**: `mrp-12-post-apireadings-device-id-validation-hmac-verification`
- **Date**: 2026-07-21
- **References**: `docs/04-prd.md` (B1, NFR Security), `docs/05-architecture-and-tech-stack.md` (Device → DB security chain)

## Summary

Build the single write path from device to database (PRD B1). The device holds
no Supabase credentials; it signs each payload with its flashed secret. This
endpoint is the gatekeeper: validate `device-id`, verify the HMAC-SHA256
signature over payload + timestamp, reject replays, validate the sensor payload,
then insert via the server-side service-role key (write-only, never returns
data).

Riding along in the same branch (beyond the ticket's ingest-only acceptance
criteria, added at the maintainer's request):

- `GET /api/v1/health` — liveness probe.
- OpenAPI 3.1 spec **derived from the same zod schema** used for validation,
  served at `GET /api/v1/openapi.json` and browsable via Swagger UI at
  `/api-docs` — both disabled in production.
- `v1` URL versioning across the API surface so firmware (MRP-15) can pin to a
  stable contract.

These extras are noted as out-of-AC scope and could be split into a follow-up
ticket if desired; they are included here because the ingest route is the first
real backend code and it is convenient to stand up the health/docs surface
alongside it.

## What this ticket does NOT touch

- **No migration.** `readings` already exists (`20260709211117_init_schema.sql`)
  with the `(device_id, timestamp desc)` unique index, and `service_role`
  already has `grant all`. The schema comment already mandates the
  idempotent-retry behavior implemented here.
- **No new RLS policy.** Ingest uses the service-role client (RLS bypassed).
  `readings` has no INSERT policy or grant for `authenticated`, so "only the
  server writes readings" is already enforced. An optional pgTAP assertion will
  prove `authenticated` cannot INSERT (hardening only).

## Prior art / current state

- `apps/web` is greenfield beyond the default Next.js scaffold — no `api/`,
  `services/`, `actions/`, or `lib/`. This route establishes the services-layer
  pattern (first `ServiceError`, first service).
- The ingest contract already lives in `@ws/shared`:
  - Headers: `DEVICE_ID_HEADER='x-device-id'`, `SIGNATURE_HEADER='x-signature'`,
    `TIMESTAMP_HEADER='x-timestamp'`.
  - `REPLAY_WINDOW_MS = 300_000`.
  - Types `ReadingPayload` / `SensorValues` / `Reading`.
- Device secret format (`scripts/provision-device.ts`): `randomBytes(32)
  .toString('hex')` → 64-char lowercase hex string.
- Env vars already documented in `apps/web/.env.example`: `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`.
- `createServiceRoleClient()` from `@ws/supabase-db` (starts with
  `import 'server-only'`).

## Design decisions (resolved)

| Decision | Choice |
| --- | --- |
| HMAC key interpretation | Device secret used **as-is** (the 64-char hex string as UTF-8 text) — no hex-decode step on firmware |
| Signature encoding | Lowercase **hex** in `x-signature` |
| Signed message | `x-timestamp + "." + rawBody` (exact raw request bytes, never re-serialized) |
| Anti-replay source | `x-timestamp` header = epoch-ms **send time**, refreshed per retry; drives the freshness check |
| Stored measurement time | `body.timestamp` (ISO-8601), may legitimately be old for buffered readings |
| Payload validation | **zod** schema (also the OpenAPI source of truth) |
| Test scope | **Unit + integration** |
| Health depth | **Liveness only** (no DB call) |
| OpenAPI source | **Derived from zod** (`@asteasolutions/zod-to-openapi`) |
| Docs UI | **Scalar** (`@scalar/nextjs-api-reference`), exposed in **non-production only** — see amendments; originally swagger-ui-react |
| API versioning | All endpoints under **`/api/v1`** (health included, for a uniform surface) |

## Signing / request contract (firmware contract for MRP-15)

```
POST /api/v1/readings
Headers:
  x-device-id : ws-abc123...
  x-timestamp : 1721563200000        epoch ms, SEND time, refreshed per retry
  x-signature : <lowercase hex>
Body (application/json):
  {
    "timestamp": "2026-07-21T12:00:00.000Z",   ISO-8601 UTC measurement time
    "temperature": 21.4,   "humidity": 55.0,   "pressure": 1013.2,
    "windSpeed": null, "windDirection": null, "precipitation": null
  }

Verification:
  msg    = x-timestamp + "." + rawBody
  key    = DEVICE_SECRET   (64-char hex string, used as UTF-8 text)
  sig    = HMAC_SHA256(key, msg) → lowercase hex
  replay = |Date.now() - Number(x-timestamp)| <= REPLAY_WINDOW_MS (300000)
  stored = body.timestamp
```

**Two distinct timestamps by design.** `x-timestamp` is the send time (drives
freshness, re-signed on every retry). `body.timestamp` is the measurement time,
stored in the row, and may be arbitrarily old when the device flushes buffered
readings after a network outage (PRD F6). Both are integrity-protected because
the signature covers the header timestamp plus the raw body (which contains
`body.timestamp`). Idempotency for retries is provided by the
`(device_id, timestamp)` unique index + `ON CONFLICT DO NOTHING`, not by the
replay window.

## Request flow — `app/api/v1/readings/route.ts`

`export const runtime = 'nodejs'` (needs `node:crypto` and the service-role
client). `export const dynamic = 'force-dynamic'`.

1. Read `x-device-id`, `x-timestamp`, `x-signature`. Any missing ⇒ **401**.
2. `tsMs = Number(x-timestamp)`; `NaN` or `|Date.now() - tsMs| > REPLAY_WINDOW_MS`
   ⇒ **401**. (Cheap reject before any DB hit — a stale/replayed request never
   reaches Supabase.)
3. `rawBody = await request.text()`.
4. `fetchDeviceSecret({ deviceId })` → not found ⇒ **401**. (Unknown device and
   bad signature return the **same** generic 401 — no device enumeration.)
5. `verifySignature({ secret, timestamp, rawBody, signature })` (constant-time)
   ⇒ mismatch **401**.
6. `JSON.parse(rawBody)` then zod `safeParse` ⇒ invalid JSON or out-of-range ⇒
   **400** with the validation issues.
7. `insertReading({ deviceId, ...payload })` (INSERT … ON CONFLICT DO NOTHING)
   ⇒ **201 `{ ok: true }`**. A duplicate is a silent no-op that still returns
   **201** (so a retry never burns the device's attempts). Unexpected DB error ⇒
   **500 `{ error: 'internal_error' }`**.

Devices are **not** gated on `status`: a flashed device begins sending readings
before any user claims it (per the `maintain_device_status` comment in the
schema). This is a write-only path — it never returns reading data.

### Response codes

| Code | When | Body |
| --- | --- | --- |
| 201 | accepted, or duplicate no-op | `{ "ok": true }` |
| 400 | invalid JSON or out-of-range sensor values | `{ "error": "invalid_payload", "issues": [...] }` |
| 401 | missing headers / stale-or-replayed ts / unknown device / bad signature | `{ "error": "unauthorized" }` |
| 500 | unexpected DB failure | `{ "error": "internal_error" }` |

## Health route — `app/api/v1/health/route.ts` (liveness only)

`runtime='nodejs'`, `dynamic='force-dynamic'`.

```
GET /api/v1/health → 200
{ "status": "ok", "uptime": <process.uptime()>, "timestamp": <ISO-8601> }
```

No external calls, so uptime polling can't be dragged down by Supabase latency
or falsely fail on a transient DB blip.

## API docs — OpenAPI derived from zod + Swagger UI (non-prod only)

- **Spec builder** — `lib/openapi/document.ts` builds an OpenAPI 3.1 document
  from the same `reading-schema.ts` zod schema via
  `@asteasolutions/zod-to-openapi` (fallback: zod's native JSON-Schema output).
  Docs cannot drift from validation. `info.version: '1.0.0'`,
  `servers: [{ url: '/api/v1' }]`. Documents:
  - `POST /readings` — the three HMAC headers, request body schema, responses
    `201/400/401/500`, with the full signing contract written into the endpoint
    description as the firmware reference.
  - `GET /health` — the liveness response.
- **Spec route** — `app/api/v1/openapi.json/route.ts` returns the document, or
  **404 in production**.
- **UI** — `app/api-docs/page.tsx` (server component) env-gates via `notFound()`,
  otherwise renders `app/api-docs/swagger-ui.client.tsx` (`'use client'`,
  `<SwaggerUI url="/api/v1/openapi.json" />` + `swagger-ui-react/swagger-ui.css`).
- **Gate helper** — `lib/openapi/docs-enabled.ts` → enabled when
  `process.env.VERCEL_ENV !== 'production'` (optional `API_DOCS_ENABLED`
  override documented in `.env.example`).
- **Risk** — swagger-ui-react has known React 19 peer-dependency friction. The
  plan includes a step to render it and confirm; if it will not mount under
  React 19, Scalar (`@scalar/nextjs-api-reference`) is the drop-in fallback
  pointing at the same `/api/v1/openapi.json`.

## File layout

```
apps/web/src/
  app/api/v1/readings/route.ts          POST handler (thin orchestration)
  app/api/v1/health/route.ts            GET liveness
  app/api/v1/openapi.json/route.ts      GET spec (404 in prod)
  app/api-docs/page.tsx                 server: env-gate → notFound() or render client
  app/api-docs/swagger-ui.client.tsx    'use client' <SwaggerUI/>
  lib/ingest/verify-signature.ts        pure: createHmac + timingSafeEqual, hex-safe
  lib/ingest/reading-schema.ts          zod schema → parseReadingPayload() (validation SoT)
  lib/openapi/document.ts               builds OpenAPI doc from the zod schema
  lib/openapi/docs-enabled.ts           env-gate helper
  services/database/types.ts            ServiceError
  services/readings/readings.service.ts fetchDeviceSecret(), insertReading()

packages/shared/src/constants/index.ts  + SENSOR_BOUNDS, API_VERSION, READINGS_INGEST_PATH
```

### Module contracts

- `verifySignature({ secret, timestamp, rawBody, signature }): boolean` — pure.
  Computes `HMAC_SHA256(secret, timestamp + "." + rawBody)` and compares to the
  provided hex signature with `crypto.timingSafeEqual`. Returns `false` (not
  throws) on malformed hex or length mismatch.
- `reading-schema.ts` — exports the zod schema and
  `parseReadingPayload(json: unknown)` returning a discriminated
  `{ ok: true; data } | { ok: false; issues }`. Extra unknown fields are
  stripped (not `.strict()`) so firmware can add fields later without a 400.
- `services/readings/readings.service.ts`:
  - `fetchDeviceSecret(supabase, { deviceId }): Promise<string | null>` —
    selects `secret` from `devices` (service-role only), `.maybeSingle()`, no
    `status` filter. Throws `ServiceError` on a real error; returns `null` when
    absent.
  - `insertReading(supabase, { deviceId, payload }): Promise<void>` —
    `.upsert(row, { onConflict: 'device_id,timestamp', ignoreDuplicates: true })`
    (= INSERT … ON CONFLICT DO NOTHING). Insert payload uses snake_case columns.
    Throws `ServiceError` on error; a conflict is a silent no-op.
- `ServiceError extends Error` with `code?` and `details?` (per CLAUDE.md).

## Validation bounds (zod, tunable)

`SENSOR_BOUNDS` in `@ws/shared/constants`, co-located with the ingest contract:

| field | rule |
| --- | --- |
| temperature | −90 … 60 °C |
| humidity | 0 … 100 % |
| pressure | 300 … 1100 hPa (BME280 operating range) |
| windSpeed | ≥ 0, ≤ 120 km/h, nullable |
| windDirection | 0 … 360°, nullable |
| precipitation | 0 … 500 mm, nullable |
| timestamp | valid ISO-8601 datetime string |

## Testing

Per CLAUDE.md: tests live in the workspace `tests/` folder mirroring `src/`,
never beside source.

### Unit (`apps/web/tests/unit/`, jest `unit` project)

- `lib/ingest/verify-signature.test.ts` — correct signature passes; tampered
  body fails; wrong secret fails; malformed hex fails; wrong-length fails.
- `lib/ingest/reading-schema.test.ts` — valid payload; each out-of-range field
  rejected; missing required field rejected; wrong type rejected; nullable
  fields accept `null`; unknown extra field stripped.
- `app/api/v1/readings/route.test.ts` — happy path → 201 (service called with
  the mapped row); unknown device → 401; bad signature → 401; stale/replayed
  `x-timestamp` → 401; missing headers → 401; malformed body → 400; duplicate →
  201. Mocks `@ws/supabase-db` and the `readings.service` module; stubs
  `Date.now`.
- `app/api/v1/health/route.test.ts` — 200 with `{ status, uptime, timestamp }`.
- `app/api/v1/openapi.json/route.test.ts` — returns a document containing the
  `/readings` path and reading schema when enabled; 404 when
  `VERCEL_ENV==='production'` (env mocked).
- `lib/openapi/docs-enabled.test.ts` — true/false per `VERCEL_ENV` and override.

The Swagger UI client page is a thin third-party wrapper; no unit test (heavy in
jsdom). Its rendering is checked manually in the verification step.

### Integration (`apps/web/tests/integration/`, new jest `integration` project)

Requires local Supabase (ports per CLAUDE.md); run `yarn db-reset:local` first.
Two clients: service-role for setup/teardown, service-role for assertions
(ingest is a service path). Cleanup in `afterEach` (delete the device →
cascade-deletes readings).

- `services/readings/readings.service.integration.test.ts` — seed a device;
  `insertReading` writes exactly one row; a duplicate `(device_id, timestamp)`
  is a silent no-op (row count stays 1); `fetchDeviceSecret` returns the secret
  for a known device and `null` for an unknown one.

New wiring: add an `integration` project to `apps/web/jest.config.mjs` and a
`test:integration` script (`jest --selectProjects=integration ...`).

### pgTAP (optional hardening)

`infra/supabase-db/supabase/tests/` — assert the `authenticated` role cannot
`INSERT` into `readings` (proves only the service path writes).

## Dependency & config changes (`apps/web`)

- Add deps: `zod`, `@supabase/supabase-js` (for the `SupabaseClient<Database>`
  type in service signatures), `@asteasolutions/zod-to-openapi`,
  `swagger-ui-react`, `@types/swagger-ui-react`.
- `jest.config.mjs`: add the `integration` project; add a `server-only` stub to
  `moduleNameMapper` if it is transitively loaded by any unit test.
- `.env.example`: document the optional `API_DOCS_ENABLED` override.
- `@ws/shared`: add `SENSOR_BOUNDS`, `API_VERSION = 'v1'`,
  `READINGS_INGEST_PATH = '/api/v1/readings'`.

## Build sequence

1. `@ws/shared`: add `SENSOR_BOUNDS`, `API_VERSION`, `READINGS_INGEST_PATH`.
2. `services/database/types.ts` (`ServiceError`).
3. `services/readings/readings.service.ts` (`fetchDeviceSecret`,
   `insertReading`) + integration test.
4. `lib/ingest/verify-signature.ts` + unit test.
5. `lib/ingest/reading-schema.ts` + unit test.
6. `app/api/v1/readings/route.ts` + unit test.
7. `app/api/v1/health/route.ts` + unit test.
8. `lib/openapi/docs-enabled.ts` + `lib/openapi/document.ts` +
   `app/api/v1/openapi.json/route.ts` + unit tests.
9. `app/api-docs/page.tsx` + `swagger-ui.client.tsx` (manual render check).
10. Optional pgTAP hardening test.
11. `yarn lint && yarn check-types && yarn test:unit && yarn build`; integration
    tests against local Supabase; manual Swagger UI check.

## Acceptance criteria mapping

- POST accepts JSON + `device-id` header + signature → §Request flow.
- HMAC-SHA256 over payload + timestamp, constant-time compare → §Signing
  contract, `verifySignature`.
- Unknown device / bad signature / replay → 401 → §Response codes.
- Valid request inserts one row via service-role, returns 2xx → `insertReading`,
  201.
- Malformed/out-of-range values → 400 → zod schema.
- Unit tests: happy, unknown device, bad signature, replayed timestamp,
  malformed body → §Unit.

## Implementation amendments (2026-07-21)

Recorded after implementation. These supersede the `swagger-ui-react`
references in the sections above (§9, file layout, deps, testing).

- **Docs UI is Scalar, not swagger-ui-react.** The documented React-19 risk
  materialized under Turbopack: swagger-ui-react's `apidom` OpenAPI-3.1 resolver
  throws `OpenApi3_1Element.refract is not a function` at runtime (SSR returns
  200 but the client never renders). Executed the planned fallback,
  `@scalar/nextjs-api-reference`. `/api-docs` is now a **gated route handler**
  (`app/api-docs/route.ts`) returning Scalar's self-contained HTML — no
  client-side React hydration — behind the same `areDocsEnabled()` gate.
  `app/api-docs/page.tsx` and `swagger-ui.client.tsx` were removed;
  `swagger-ui-react` + `@types/swagger-ui-react` uninstalled;
  `@scalar/nextjs-api-reference` added.
- **Integration-test env via Infisical.** Secrets inject at runtime with
  `infisical run`. Added `test:integration:secrets` =
  `infisical run --project-config-dir=../.. -- yarn test:integration`;
  `test:integration` stays pure/env-based so CI (machine identity via
  `INFISICAL_TOKEN`) still works. `.infisical.json` is gitignored;
  `apps/web/.env.example` and CLAUDE.md document the workflow.
- **Test coverage expanded beyond the AC minimum.** Added: replay
  future-timestamp, both window boundaries, and non-numeric timestamp;
  timestamp-binding (tamper `x-timestamp` without re-signing) at both the
  `verifySignature` and route levels; a full-length forged signature (exercises
  the constant-time compare, not the length short-circuit); the
  500-on-service-error branch; and an integration value-persistence assertion.
  **Final: 37 unit + 3 integration tests, all green.**
