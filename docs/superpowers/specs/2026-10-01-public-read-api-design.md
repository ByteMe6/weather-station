# Public station API (key-authenticated) — design

**Date:** 2026-10-01
**Branch:** `feat/public-read-api`
**Status:** approved for planning

## 1. Goal

A signed-in user can create **personal API keys** in Settings and use them from
their own scripts and tools (curl, Python, Grafana, Home Assistant, a small
website of their own) to:

- list the stations they have access to (owned **and** shared), with names,
  addresses and locations;
- read the latest reading, raw history and aggregated history of any of those
  stations;
- edit station details (nickname, address, coordinates) where their role allows
  it (owner / editor — `canEditDeviceProfile`).

A key can never reach a station its user is not a member of, and access follows
membership live: when a share is removed, the key loses that station on the
next request.

Explicitly **not** goals: third-party OAuth apps, a native mobile app login,
anonymous/public stations, sharing or role management over the API, admin
(fleet-wide) keys, per-key station allow-lists, webhooks/streaming, writing
readings (devices keep the HMAC ingest).

## 2. Decisions and why

| Decision | Choice | Why |
| --- | --- | --- |
| Consumer | The user's own scripts/tools | No consent screen or OAuth flow needed; a long-lived bearer credential fits. |
| Login | **Our own API keys** (`Authorization: Bearer wsk_live_…`) | Full control, no Clerk machine-auth dependency or billing. Email+password was rejected: Clerk has no first-class server-side password login, it breaks OAuth-only accounts and MFA, and puts the real password into scripts. Clerk session JWTs expire in ~60 s. |
| Key scope | `read` or `read_write`, chosen at creation | A read key leaked from a Grafana config or a website cannot change anything. |
| Expiry | User picks 30 / 90 / 365 days or never (default 90) | Bounded blast radius for forgotten keys without forcing churn on home scripts. |
| Key cap | 10 active keys per user | Keeps the Settings list and the rate-limit table small. |
| Rate limiting | Postgres fixed-window counter, 60 req/min per key | Stays inside the PRD's Vercel + Supabase-only infrastructure; no Upstash. |
| Data access | **Service-role client + explicit gate in code** (approach A) | Reuses existing services, `resolveMemberRole`, and the shared role predicates; the documented pattern for service-role paths (server actions, bot). Rejected: minting Supabase JWTs (adds a second trusted issuer next to Clerk — widens what can forge an identity) and per-endpoint `SECURITY DEFINER` RPCs (duplicates every service, still trusts a `p_user_id` argument). |
| Versioning | Additive to `/api/v1`; `specVersion` `1.0.0` → `1.1.0` | Backwards-compatible change; the path never carries semver (CLAUDE.md). |
| Docs | `/reference` enabled in production by default | Users writing scripts need the reference; the ingest docs describe the signing scheme, never secrets. `API_DOCS_ENABLED=false` still forces it off. |
| CORS | `*` on GET + `OPTIONS`; **none** on PATCH | Users may build a small site of their own. No cookies are involved, so no CSRF exposure; a write key in browser JS would let any visitor edit stations, so the browser is not allowed to send PATCH. |

## 3. Data model (one migration)

### 3.1 `public.api_keys`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid pk default gen_random_uuid()` | |
| `user_id` | `uuid not null references public.users (id) on delete cascade` | btree index `api_keys_user_id_idx` |
| `name` | `text not null check (char_length(name) between 1 and 60)` | e.g. "Grafana" |
| `key_hash` | `bytea not null unique` | SHA-256 of the full key string; the key itself is never stored |
| `key_hint` | `text not null check (char_length(key_hint) = 4)` | last 4 chars, shown as `wsk_live_…a9Xk` |
| `scope` | `text not null check (scope in ('read', 'read_write'))` | mirrors `API_KEY_SCOPES` in `@ws/shared` |
| `expires_at` | `timestamptz null` | null = never |
| `last_used_at` | `timestamptz null` | throttled to ≤ 1 write/min |
| `created_at` | `timestamptz not null default now()` | |
| `revoked_at` | `timestamptz null` | revocation is a soft delete so the list can show it |

- RLS **enabled with no policies**; no grants to `anon` / `authenticated`.
  Only service-role code touches it — the same posture as `devices.secret`.
- Plain SHA-256 (not bcrypt/argon2) is correct: keys carry 256 bits of
  randomness, so brute force is infeasible, and a deterministic hash allows a
  single indexed equality lookup.
- The 10-active-keys cap is enforced in `createApiKeyAction` (count of rows with
  `revoked_at is null and (expires_at is null or expires_at > now())`).

### 3.2 `public.api_key_rate_limits`

| Column | Type |
| --- | --- |
| `key_id` | `uuid pk references public.api_keys (id) on delete cascade` |
| `window_start` | `timestamptz not null` |
| `count` | `int not null` |

One row per key; the window resets in place, so the table needs no cleanup job.
RLS enabled, no policies, no client grants.

### 3.3 `public.api_authenticate(p_key_hash bytea)`

`VOLATILE` (it writes), `security invoker`, `set search_path = ''`, `execute`
revoked from `public, anon, authenticated` and granted to `service_role` only.
Limit and window are passed as arguments (`p_limit int`, `p_window_seconds int`)
so the constants live in `@ws/shared`, not in SQL.

In one call it:

1. finds the key with `key_hash = p_key_hash and revoked_at is null and
   (expires_at is null or expires_at > now())` — no row ⇒ returns no row;
2. upserts `api_key_rate_limits`: if the stored `window_start` is older than
   the current window, reset to `(current window, 1)`, else `count + 1` —
   atomic via `insert … on conflict (key_id) do update … returning`;
3. sets `last_used_at = now()` only when it is null or older than one minute;
4. returns `user_id, key_id, scope, allowed (count <= p_limit), remaining,
   reset_at`.

A rejected (over-limit) request still counts; that is intended.

Run `yarn regenerate:types` after the migration.

## 4. HTTP surface (`/api/v1`)

Resources are called **stations** (the UI's word); the id is the device id
(`ws-…`).

| Method | Path | Key scope | Role predicate |
| --- | --- | --- | --- |
| GET | `/stations` | `read` | membership (the query itself) |
| GET | `/stations/{stationId}` | `read` | any member |
| PATCH | `/stations/{stationId}` | `read_write` | `canEditDeviceProfile` |
| GET | `/stations/{stationId}/readings/latest` | `read` | any member |
| GET | `/stations/{stationId}/readings` | `read` | any member |
| GET | `/stations/{stationId}/readings/aggregate` | `read` | any member |

A `read_write` key satisfies `read`.

### 4.1 Station object

```json
{
  "id": "ws-abc123def456",
  "name": "Balcony",
  "label": "Balcony",
  "address": "Main St 1",
  "location": { "latitude": 50.4501, "longitude": 30.5234 },
  "role": "editor",
  "status": "registered",
  "addedAt": "2026-08-16T10:00:00.000Z",
  "createdAt": "2026-07-10T09:00:00.000Z",
  "lastReadingAt": "2026-10-01T08:55:00.000Z"
}
```

- `name` = `label ?? id` (same rule as `deviceDisplayName`).
- `location` is `null` when no coordinates are set.
- `lastReadingAt` comes from one latest-reading lookup per station
  (`(device_id, timestamp desc)` index), `null` if the station never reported.
- Members, their identities and the device secret are never part of any
  response.

`GET /stations` returns `{ "data": Station[] }`, oldest membership first.

### 4.2 PATCH `/stations/{stationId}`

Body: `{ label?, address?, latitude?, longitude? }` (JSON).

- An **omitted** field keeps its stored value; **`null`** clears it.
- `latitude`/`longitude` must end up both set or both null (mirrors
  `devices_coords_both_or_neither`); a half pair ⇒ 400 with `fieldErrors`.
- Limits reuse the existing profile validation: label 1–40 chars, address
  1–200 chars (trimmed), latitude −90…90, longitude −180…180.
- An empty body or unknown keys ⇒ 400.
- `update_device_profile()` replaces all four columns, so the route reads the
  current row, merges the patch, then calls the RPC (which re-checks the role
  in SQL). The response is the **row the RPC returned**, mapped to a Station —
  never an echo of the input. A `DEVICE_PROFILE_FORBIDDEN` from the RPC after
  the gate passed is logged as gate/RPC disagreement and answered 403.

### 4.3 Readings

Reading object: `{ timestamp, temperature, humidity, pressure, windSpeed,
windDirection, precipitation }` (the existing `READING_COLUMNS` aliasing).

**Latest** — `{ "data": Reading | null }`.

**Raw history** — `GET …/readings?from=&to=&limit=&cursor=`

- `from`, `to`: ISO 8601 datetimes; default `to = now`, `from = to − 24h`;
  `from < to`; span ≤ **31 days**.
- `limit`: 1–**1000** (PostgREST `max_rows`), default 288.
- Ascending by `(timestamp, id)` via the existing `fetchReadingsPage`.
- Response `{ "data": Reading[], "nextCursor": string | null }`; the cursor is
  base64url JSON `{ "timestamp": ISO, "id": int }`, validated (zod) before use
  because its timestamp is interpolated into a PostgREST filter.
  `nextCursor` is null when fewer than `limit` rows came back.

**Aggregate** — `GET …/readings/aggregate?from=&to=&interval=`

- `interval` ∈ `15m | 1h | 6h | 1d` (1440 minutes is the ceiling
  `readings_bucketed` accepts); default `1h`.
- Span must produce ≤ 1000 buckets (e.g. ≤ ~41 days at `1h`, ≤ 366 days at
  `1d`, hard cap 366 days); default window last 7 days.
- Response `{ "data": BucketedRow[], "interval": "1h" }` using the existing
  `BucketedRow` fields.

### 4.4 Errors

Single envelope: `{ "error": { "code": string, "message": string,
"fieldErrors"?: Record<string, string> } }`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | bad query/body/cursor, span too large |
| 401 | `UNAUTHORIZED` | missing, malformed, unknown, revoked or expired key — **one body for all** |
| 403 | `INSUFFICIENT_SCOPE` | `read` key on PATCH |
| 403 | `FORBIDDEN` | member without `canEditDeviceProfile` on PATCH |
| 404 | `NOT_FOUND` | station does not exist **or** caller is not a member — indistinguishable, so keys cannot probe which ids exist |
| 429 | `RATE_LIMITED` | over 60 req/min for this key |
| 500 | `INTERNAL` | anything else (logged server-side, no detail leaked) |

Ordering: authenticate (401) → rate limit (429) → scope (403) → input
validation (400) → membership (404) → role (403).

### 4.5 Headers

- Every authenticated response: `RateLimit-Limit`, `RateLimit-Remaining`,
  `RateLimit-Reset` (seconds); 429 adds `Retry-After`.
- Every response: `Cache-Control: no-store`.
- GET and `OPTIONS` on station routes: `Access-Control-Allow-Origin: *`,
  `Access-Control-Allow-Headers: Authorization`, `Access-Control-Allow-Methods:
  GET, OPTIONS`, `Access-Control-Expose-Headers` for the `RateLimit-*` headers.
  **No** `Access-Control-Allow-Credentials`. PATCH responses carry no CORS
  headers and the preflight does not list PATCH, so browsers refuse it.

## 5. Components

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `packages/shared` — `api-keys.ts` | `API_KEY_PREFIX = 'wsk_live_'`, `API_KEY_SCOPES`, `ApiKeyScope`, `API_RATE_LIMIT` (60/60s), `API_KEY_MAX_ACTIVE` (10), expiry choices, span/limit caps, `ApiStation` / `ApiErrorBody` DTOs | — |
| `lib/api/key.ts` | generate key (32 random bytes, base64url), SHA-256 hash, `parseBearer(header)`; pure, no DB | node `crypto` |
| `lib/api/respond.ts` | JSON success/error builders, rate-limit + CORS + `no-store` headers | shared |
| `lib/api/with-api-key.ts` | **the only entry point for station routes**: parse key → `authenticateApiKey` → 401/429 → scope check → `handler(req, { service, userId, keyId, scope }, params)`; catches `ServiceError` ⇒ 500 | key, respond, api-keys service |
| `lib/api/station-gate.ts` | `requireStationRole(ctx, stationId, predicate)` → role or 404/403 response; uses `resolveMemberRole` and the shared predicates — no local re-spelling | `actions/_helpers` resolvers, `@ws/shared` |
| `services/api-keys/api-keys.service.ts` | `createApiKey`, `listApiKeys`, `revokeApiKey`, `countActiveApiKeys`, `authenticateApiKey` (calls `api_authenticate`) | supabase-db |
| `services/devices/devices.service.ts` — `fetchStationsForUser(service, { userId })` | stations for one user with an **explicit** `.eq('user_id', userId)` | — |
| `services/readings` | reuse `fetchLatestReading`, `fetchReadingsPage`, `fetchReadingsBucketed` unchanged | — |
| `actions/api-keys.action.ts` | `createApiKeyAction({ name, scope, expiresInDays })` (returns the secret once), `listApiKeysAction`, `revokeApiKeyAction` — Clerk `auth()` + service role, `ActionResult` | api-keys service |
| `services/api-keys/api-keys.queries.ts` | `apiKeyKeys`, `useApiKeysQuery`, `useCreateApiKeyMutation`, `useRevokeApiKeyMutation` via `unwrapAction` | actions |
| `components/settings/ApiKeysCard.tsx` | list (name, scope, hint, created, last used, expires), create dialog, show-once secret with copy, revoke; skeleton while loading; CORS/public-key warning; link to `/reference` | queries |
| Route handlers under `app/api/v1/stations/` | `route.ts` (GET, OPTIONS), `[stationId]/route.ts` (GET, PATCH, OPTIONS), `[stationId]/readings/route.ts`, `…/latest/route.ts`, `…/aggregate/route.ts` — each export wrapped in `withApiKey` | all of the above |
| `lib/openapi/document.ts` | register the six operations and a `bearerAuth` security scheme in `registerV1Paths` (additive); `API_VERSION_META.v1.specVersion = '1.1.0'` | — |
| `lib/openapi/docs-enabled.ts` | default **on** in production; `API_DOCS_ENABLED` override unchanged | — |

**Trap this design avoids:** `fetchMyDevices` has no `WHERE` clause and relies
on RLS meaning "own rows only". On the service-role client it would return
**every user's** stations. The API must never call it;
`fetchStationsForUser` carries a comment saying why, and its integration test
pins user isolation.

**Proxy:** `src/proxy.ts` already lists `/api/v(.*)` in `PUBLIC_ROUTES`, so
Clerk middleware lets key-authenticated requests through to `withApiKey`
unchanged. A test pins that a `Bearer wsk_live_…` header is treated as
signed-out by Clerk (our prefix does not match Clerk machine-token prefixes)
rather than rejected.

## 6. Request flow

```
script ──Bearer wsk_live_…──▶ proxy.ts (public route, pass)
  ▶ withApiKey
      parseBearer ──fail──▶ 401
      sha256 → api_authenticate(hash, 60, 60)  (one DB round trip)
          no row ─▶ 401      allowed=false ─▶ 429 + Retry-After
      scope check ─▶ 403 INSUFFICIENT_SCOPE
  ▶ route handler
      zod-validate params/query/body ─▶ 400
      requireStationRole(ctx, id, predicate) ─▶ 404 / 403
      existing service (service-role client, filtered by device_id)
      (PATCH: read current row → merge → update_device_profile RPC)
  ◀ JSON + RateLimit-* + CORS(GET) + no-store
```

## 7. Settings UI

A new **API keys** card on `/settings`:

- Table of keys: name, scope badge, `wsk_live_…XXXX`, created, last used,
  expires (or "Never"), revoked state; Revoke button per active key.
- "Create key" dialog: name, scope (`Read` / `Read & write`), expiry
  (30 / 90 / 365 days / Never, default 90). Disabled at 10 active keys with an
  explanation.
- After creation: the full key in a copyable field with "You won't see this
  again", plus a ready-to-run `curl` example.
- Warning text: a key placed in a website's JavaScript is public — use a
  `Read` key only, and note it exposes the address and coordinates of every
  station you can see; prefer calling the API from your own server.
- Skeleton while loading (checks Clerk `isLoaded`); `testId` on every element.

## 8. Testing

**pgTAP** — `supabase/tests/api_keys.sql`:
- `anon` / `authenticated` cannot select/insert/update/delete `api_keys` or
  `api_key_rate_limits`, and cannot execute `api_authenticate`.
- `api_authenticate` returns no row for unknown, revoked and expired keys.
- Counter increments within a window, resets in a new window; the 61st call in
  a window returns `allowed = false`.
- `last_used_at` is not rewritten within a minute.
- Deleting a user cascades to their keys and rate-limit rows.

**Unit (Jest, `tests/unit/` mirroring `src/`)**:
- `lib/api/key`: prefix/length/charset, hash determinism, `parseBearer`
  (missing header, non-Bearer scheme, wrong prefix, extra whitespace).
- `withApiKey`: 401 (one body for every failure), 429 with headers, 403
  `INSUFFICIENT_SCOPE`, `ServiceError` ⇒ 500 without detail.
- **Route registry test**: every exported handler under
  `app/api/v1/stations/**/route.ts` is produced by `withApiKey` (or is the
  shared `OPTIONS` handler); fails when a handler is added without the gate.
- `requireStationRole`: non-member ⇒ 404, viewer on PATCH ⇒ 403; added to the
  CLAUDE.md predicate-mutation list (narrowing `canEditDeviceProfile` must now
  fail 1 shared + 5 web tests).
- Route handlers: query validation and span caps, cursor round-trip and
  tamper rejection, PATCH merge (omitted keeps / null clears / half pair 400 /
  empty body 400), CORS present on GET + OPTIONS and absent on PATCH.
- Proxy: a request with `Authorization: Bearer wsk_live_…` to a station route
  is not redirected or rejected by Clerk middleware.
- `ApiKeysCard`: skeleton, create flow shows the secret once, revoke, cap
  message.
- OpenAPI: the six operations and `bearerAuth` are present, `specVersion` is
  `1.1.0`, `versions.test.ts` stays green.

**Integration (real local Supabase)**:
- `api-keys.service`: create/list/revoke/authenticate, expiry, error paths.
- `fetchStationsForUser`: user A never sees user B's stations (owned or
  shared); shared stations appear with the right role.

**Manual (`/verify`)**: create a key in Settings, then curl all six endpoints;
read key ⇒ 403 on PATCH; viewer ⇒ 403; other user's station ⇒ 404; 61st
request ⇒ 429; from another origin in a browser, `fetch` GET succeeds and
PATCH is blocked.

Reviews: `rls-reviewer` on the migration, `data-path-reviewer` on the web
changes.

## 9. Documentation changes

- `docs/04-prd.md` B3: amend — the web app and bot still read Supabase
  directly; a separate key-authenticated API exists for users' own scripts.
  Add the API-key auth line to the Authentication row.
- `docs/privacy-data-minimisation.md`: the API exposes addresses and
  coordinates to key holders; browser-embedded keys make them public.
- `CLAUDE.md`: a third row in the data-path picture (key-authenticated API,
  service-role + `withApiKey` + `requireStationRole`), the `fetchMyDevices`
  trap, the updated predicate-mutation counts, and the docs-in-production
  change.

## 10. Rollout

1. Migration → `yarn regenerate:types`.
2. Deploy to Vercel (no new environment variables).
3. `/reference` becomes visible in production with the new operations.
