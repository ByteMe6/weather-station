# API versioning — versioned docs & version registry

**Date:** 2026-08-11
**Status:** Draft — awaiting review

## Problem

`apps/web/src/app/api-docs/route.ts` renders exactly one OpenAPI document and
hardcodes its URL:

```ts
const reference = ApiReference({ url: '/api/v1/openapi.json' })
```

The HTTP routes are already version-scoped (`app/api/v1/{readings,health,openapi.json}`),
but the documentation layer is not. Three things block a second version:

1. `packages/shared/src/constants/index.ts:21` exports `API_VERSION = 'v1'` — a
   **singular** constant. `READINGS_INGEST_PATH` is derived from it. Bumping it
   to `'v2'` silently repoints every doc, example and firmware reference,
   including for the fleet still speaking v1.
2. `apps/web/src/lib/openapi/document.ts` is a singleton `buildOpenApiDocument()`
   with a hardcoded `info.version: '1.0.0'` and `servers: [{ url: '/api/v1' }]`.
   There is no way to produce a second document.
3. `/api-docs` is a single unversioned URL with no switcher.

**Requirement:** v1 must keep working after v2 ships, and readers must be able to
switch between version docs easily. The same must hold for v3 and beyond.

## Two version axes

The design keeps these strictly separate. Conflating them is the main failure
mode this spec prevents.

| Axis              | Lives in                  | Format                | Bumps when                                    |
| ----------------- | ------------------------- | --------------------- | --------------------------------------------- |
| **Path version**  | `/api/v1/...`             | major only — `v1`,`v2`| a **breaking** contract change                |
| **Spec version**  | OpenAPI `info.version`    | full semver — `1.0.1` | **any** change to that version's surface      |

`v1.0.1` is therefore supported — as `info.version: '1.0.1'` served at
`/api/v1/openapi.json`, never as a URL segment.

**Why patch versions must never enter the path:** each device holds its own full
ingest URL in NVS, falling back to the flash-time `API_URL` build flag
(`firmware/secrets.ini.example:7`; see "Changing the endpoint" in
`firmware/README.md`). A device pinned to `/api/v1.0.0/readings` would stop
ingesting the moment the server moved to `v1.0.1`, and recovering it means
repointing that device individually — reflashing it, or hand-editing the URL in
its LAN setup portal, a field the README documents as silently truncating past
128 characters. There is no fleet-wide URL push. Patch and minor changes are
backwards-compatible by definition, so the URL must not move for them.

Only the **current** spec per major version is served. Historical patch specs live
in git, not on a URL.

## Design

### 1. Version registry in `@ws/shared`

Replace the singular constant with a list plus a helper. The path-version axis is
a device-facing contract, so it belongs in shared.

```ts
// packages/shared/src/constants/index.ts

/** Every path version the backend currently serves, oldest first. */
export const API_VERSIONS = ['v1'] as const
export type ApiVersion = (typeof API_VERSIONS)[number]

/** The version new clients should target. */
export const LATEST_API_VERSION: ApiVersion = 'v1'

/**
 * Ingest path for a given version. Callers must name the version explicitly —
 * there is deliberately no unversioned alias, because deployed firmware pins a
 * version at flash time and must never be repointed by a constant bump.
 */
export const readingsIngestPath = (version: ApiVersion): string =>
  `/api/${version}/readings`
```

`API_VERSION` and `READINGS_INGEST_PATH` are **removed**. `READINGS_INGEST_PATH`
has no code consumers today (only doc prose), so this is a cheap break, and
removing it is the point: an unversioned path constant is exactly the trap
described above.

### 2. Per-version doc metadata in `apps/web`

The spec-version axis is documentation metadata, consumed only by the OpenAPI
builder and the docs switcher, so it stays in the web app.

```ts
// apps/web/src/lib/openapi/versions.ts
import type { ApiVersion } from '@ws/shared'

export type ApiVersionMeta = {
  /** OpenAPI info.version — bumped for any change to this version's surface. */
  specVersion: string
  status: 'current' | 'deprecated'
  /** RFC 8594 sunset date (ISO), set when a version is deprecated. */
  sunset?: string
}

export const API_VERSION_META: Record<ApiVersion, ApiVersionMeta> = {
  v1: { specVersion: '1.0.0', status: 'current' },
}
```

### 3. `buildOpenApiDocument(version)`

`document.ts` takes a version and looks up both axes. Path registration becomes a
per-version function so that a shipped version's operation list is frozen in its
own function and never edited again.

```ts
const PATH_REGISTRARS: Record<ApiVersion, (registry: OpenAPIRegistry) => void> = {
  v1: registerV1Paths, // current body of buildOpenApiDocument, extracted verbatim
}

export const buildOpenApiDocument = (version: ApiVersion) => {
  const registry = new OpenAPIRegistry()
  PATH_REGISTRARS[version](registry)

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Weather Station Ingest API',
      version: API_VERSION_META[version].specVersion,
    },
    servers: [{ url: `/api/${version}` }],
  })
}
```

### 4. Docs live under the version, and carry a switcher

Two mechanisms, each covering the other's weakness:

- **Per-version route** `/api/{version}/reference` — a permanent, bookmarkable URL that
  shares its version's lifecycle. Retiring v1 is `rm -rf app/api/v1`, which takes
  its docs with it.
- **Scalar `sources` dropdown** — so a reader who lands on v1 docs can discover
  and jump to v2. Confirmed supported by the installed
  `@scalar/nextjs-api-reference@0.11.11`: `ApiReference` accepts
  `Partial<HtmlRenderingConfiguration>`, which is
  `Partial<ApiReferenceConfigurationWithMultipleSources> & {...}`, and
  `ApiReferenceConfigurationWithMultipleSources` carries
  `sources: SourceConfiguration[]` with `{ url, title, slug, default }`.

```ts
// apps/web/src/lib/openapi/reference.ts
import { ApiReference } from '@scalar/nextjs-api-reference'
import { API_VERSIONS, type ApiVersion } from '@ws/shared'

import { API_VERSION_META } from './versions'

/**
 * A Scalar reference page for `current` that also lists every other served
 * version in its document dropdown — so any docs URL can reach any version.
 */
export const createVersionedReference = (current: ApiVersion) =>
  ApiReference({
    sources: API_VERSIONS.map((version) => {
      const { specVersion, status } = API_VERSION_META[version]
      const suffix = status === 'deprecated' ? ' — deprecated' : ''
      return {
        url: `/api/${version}/openapi.json`,
        title: `${version} · ${specVersion}${suffix}`,
        slug: version,
        default: version === current,
      }
    }),
  })
```

The dropdown label surfaces the spec semver (`v1 · 1.0.1`) — this is where the
patch axis becomes visible to readers.

```ts
// apps/web/src/app/api/v1/reference/route.ts
import { areDocsEnabled } from '@/lib/openapi/docs-enabled'
import { createVersionedReference } from '@/lib/openapi/reference'

export const dynamic = 'force-dynamic'

const reference = createVersionedReference('v1')

export const GET = (): Response | Promise<Response> =>
  areDocsEnabled() ? reference() : new Response('Not Found', { status: 404 })
```

`/api-docs` becomes a redirect so existing links and bookmarks survive:

```ts
// apps/web/src/app/api-docs/route.ts
import { LATEST_API_VERSION } from '@ws/shared'

import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

export const GET = (request: Request): Response => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  // Absolute URL required — the Web `Response.redirect` rejects relative paths.
  return Response.redirect(
    new URL(`/api/${LATEST_API_VERSION}/reference`, request.url),
    308,
  )
}
```

`openapi.json` routes stay one-per-version and become one line each:
`Response.json(buildOpenApiDocument('v1'))`.

### Resulting layout

```
packages/shared/src/constants/index.ts     API_VERSIONS, ApiVersion,
                                           LATEST_API_VERSION, readingsIngestPath()
apps/web/src/lib/openapi/
  versions.ts                              API_VERSION_META (spec semver, status, sunset)
  document.ts                              buildOpenApiDocument(version) + PATH_REGISTRARS
  reference.ts                             createVersionedReference(current)
  docs-enabled.ts                          unchanged
apps/web/src/app/
  api/v1/openapi.json/route.ts             buildOpenApiDocument('v1')
  api/v1/reference/route.ts                     createVersionedReference('v1')
  api-docs/route.ts                        308 → /api/{LATEST}/reference
```

## Adding a version later

1. `API_VERSIONS = ['v1', 'v2']`, `LATEST_API_VERSION = 'v2'` in `@ws/shared`.
2. `API_VERSION_META.v2 = { specVersion: '2.0.0', status: 'current' }`; flip v1 to
   `status: 'deprecated'` with a `sunset` date.
3. `registerV2Paths` + a `PATH_REGISTRARS.v2` entry. **`registerV1Paths` is not
   edited.**
4. `app/api/v2/{docs,openapi.json}/route.ts` — three lines each.
5. Route handlers for the v2 endpoints themselves (out of scope here — see below).

Every existing docs page picks up v2 in its dropdown automatically, and
`/api-docs` follows `LATEST_API_VERSION`.

A **patch or minor** change to a live version is step 2 only: bump `specVersion`.

## Out of scope

Deliberately excluded to keep this focused on the docs layer:

- **Route-handler sharing across versions.** How `app/api/v2/readings/route.ts`
  reuses the HMAC/replay/insert mechanism in `app/api/v1/readings/route.ts` is a
  separate design, to be settled when a v2 contract actually exists.
- **`Deprecation` / `Sunset` response headers** (RFC 8594) on deprecated version
  routes. `API_VERSION_META` carries the `status`/`sunset` fields so this can be
  added without a schema change; emitting them is follow-up work.
- **Per-version request telemetry.** Worth having before retiring any version —
  you cannot safely drop v1 without evidence that no device still calls it.

## Testing

| Test                                            | Asserts                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `tests/unit/lib/openapi/document.test.ts`       | `buildOpenApiDocument('v1')` → `servers[0].url === '/api/v1'`, `info.version === API_VERSION_META.v1.specVersion` |
| `tests/unit/lib/openapi/reference.test.ts`      | `createVersionedReference` emits one source per `API_VERSIONS` entry, exactly one `default: true`, matching the argument |
| `tests/unit/app/api/v1/reference/route.test.ts`      | 200 + HTML when docs enabled; 404 when disabled              |
| `tests/unit/app/api-docs/route.test.ts`         | 308 to `/api/{LATEST_API_VERSION}/docs`; 404 when disabled   |
| existing `app/api/v1/openapi.json/route.test.ts`| still green (already asserts `servers[0].url === '/api/v1'`) |

Manual: `yarn dev`, then confirm `/api-docs` redirects, `/api/v1/reference` renders,
and the dropdown lists every entry in `API_VERSIONS`.

## Documentation & harness updates

These make the convention stick for future work rather than living only here.

| File | Change |
| ---- | ------ |
| `CLAUDE.md` | New "API versioning" subsection under *Device Ingest*: the two-axis table, docs at `/api/{version}/reference`, and the add-a-version checklist. Fix stale `/api/readings` → `/api/v1/readings` at lines 95 and 342. |
| `docs/05-architecture-and-tech-stack.md` | Fix stale `/api/readings` → `/api/v1/readings` (lines 11, 27); state the path-version-on-breaking-change-only policy. |
| `.claude/skills/verify/SKILL.md` | Line 22–25: correct the path to `/api/v1/readings`; add — when API versions change, curl every `/api/{v}/openapi.json` and `/api/{v}/docs`, plus assert the `/api-docs` 308. |
| `.claude/skills/new-api-version/SKILL.md` | **New skill**, modelled on `new-migration`: the numbered "Adding a version later" checklist above, with the "never edit a shipped `registerVxPaths`" and "never put semver in the path" rules stated explicitly. This is the mechanism that makes agents follow the convention next time. |
| `firmware/secrets.ini.example` | Comment on the `-DAPI_URL=".../api/v1/readings"` flag recording that `v1` is a pinned major version, that this flag is only the NVS fallback, and that it changes only when migrating a device to a new contract. |

`firmware/README.md` needs no change — its "Changing the endpoint" section
already describes the per-device NVS/portal mechanism accurately and never names
a version-specific path.

## Risks

- **Removing `API_VERSION` / `READINGS_INGEST_PATH` is a breaking `@ws/shared`
  change.** Mitigated by there being a single code consumer (`document.ts`);
  `yarn check-types` from root catches any miss.
- **Scalar `sources` behaviour is verified by type only.** The multi-source config
  is type-valid in the installed version; the rendered dropdown must be confirmed
  in a browser during verification, not assumed.
- **A one-entry dropdown** is what ships initially (only v1 exists). That is
  correct and self-resolving, but should be eyeballed so it does not render as a
  broken control.

---

## Amendments (during implementation)

The sections above record the design as approved. These changed while building
it; the code is the source of truth where they differ.

1. **One `/reference` page, not one per version.** The design put a reference
   route under every version (`/api/{version}/reference`), each rendering the
   same `sources` dropdown with a different `default`. That is N near-identical
   pages, and it carries a stale-argument bug — a route cloned for v2 keeping
   `createVersionedReference('v1')`.

   The distinction that resolves it: **`openapi.json` is the versioned
   artifact; the reference is a UI that reads all of them and has no version of
   its own.** So there is a single top-level `app/reference/route.ts` — also
   Scalar's own documented layout — whose dropdown covers every `API_VERSIONS`
   entry and opens on `LATEST_API_VERSION`. `createVersionedReference(current)`
   became `createReference()` with no argument, deleting that bug class rather
   than testing for it. `/api-docs` now 308s to `/reference`.

   Checked before committing to this: Scalar routes within the page by URL
   **hash** (`#tag/...`) unless `pathRouting` is configured, so one route needs
   no catch-all and cannot 404 on refresh.

2. **Route segment is `reference`, not `docs`.** Scalar's Next.js integration
   documents `app/reference/route.ts`; the segment name now matches.

3. **`status` gained `preview`.** The design had `current | deprecated` only.
   A version can be served and documented before it is the recommended target —
   a v2 carrying only `/health` was briefly registered this way — and marking
   two versions `current` would be
   wrong. `preview` means served and listed, not yet recommended;
   `LATEST_API_VERSION` stays on the `current` one.

4. **Drift guard added.** `tests/unit/app/api/versions.test.ts` fails when an
   `/api/v*` folder is missing from `API_VERSIONS`, or when a registered version
   has no `openapi.json` route. This came from a real miss: an `app/api/v2/`
   folder was created without registering v2, which silently produced a working
   endpoint and no documentation.

### Risk outcomes

- **Scalar `sources` verified by type only** — now resolved. The serialized
  config was confirmed in the rendered HTML, and the dropdown was confirmed
  working in a browser.
- **One-entry dropdown** — confirmed working in a browser with two versions
  registered, then v2 was removed as premature. v1 ships as the only version,
  so the dropdown is back to one entry; the multi-version path is proven.
- **Removing `API_VERSION` / `READINGS_INGEST_PATH`** — landed with no
  fallout, as predicted.
