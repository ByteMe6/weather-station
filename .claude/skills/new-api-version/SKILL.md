---
name: new-api-version
description: Add or change an HTTP API version the project way — major-only path versions, semver in OpenAPI info.version, a frozen path registrar per version, and one /reference page whose dropdown covers every version.
---

# Adding or changing an API version

The project runs **two version axes**. Conflating them is the failure this
skill exists to prevent.

| Axis             | Lives in                                    | Format                  | Bumps when                               |
| ---------------- | ------------------------------------------- | ----------------------- | ---------------------------------------- |
| **Path version** | `/api/v1/…`, `API_VERSIONS` in `@ws/shared` | major only — `v1`, `v2` | a **breaking** contract change           |
| **Spec version** | OpenAPI `info.version`, `API_VERSION_META`  | full semver — `1.0.1`   | **any** change to that version's surface |

## Two rules that are never bent

1. **Never put semver in the path.** No `/api/v1.0.1/`. Each device holds its
   own full ingest URL in NVS, falling back to the flash-time `API_URL` build
   flag (`firmware/secrets.ini.example`). A path segment that moved on a patch
   release would cut off every deployed device until it was repointed one at a
   time — by reflashing, or by hand through its LAN setup portal
   (`firmware/README.md`, "Changing the endpoint"). There is no fleet-wide URL
   push.
2. **Never edit a shipped `registerVxPaths`** for a breaking change. Add a new
   registrar instead. Devices still calling v1 must keep getting the v1
   contract, and a frozen function is what guarantees that — not test coverage
   and not discipline. The freeze applies from the moment a version becomes the
   recommended target; a `preview` registrar is still editable.

## Backwards-compatible change to a live version

A new optional field, a new documented response, a corrected description:

1. Bump `specVersion` in `apps/web/src/lib/openapi/versions.ts`
   (`1.0.0` → `1.0.1` for a fix, `1.1.0` for an addition).
2. Update that version's `registerVxPaths` in
   `apps/web/src/lib/openapi/document.ts` — allowed here, since nothing breaks.
3. Nothing else moves. The path, the routes, and the firmware URL stay put.

## A route folder is not a version

Creating `app/api/v2/<endpoint>/route.ts` gives you a working endpoint and
nothing else. The docs are **not** discovered from the filesystem — they need a
spec semver, a status, and OpenAPI operation definitions, none of which a folder
carries. Skip the registration below and you get a live endpoint that never
appears in `/reference`, with no error explaining why.

`tests/unit/app/api/versions.test.ts` catches this: it fails when a `/api/v*`
folder is missing from `API_VERSIONS`, or when a registered version has no
`openapi.json/route.ts`. If it fails, work the list below.

## One reference page, many specs

`openapi.json` is per-version — it _is_ the versioned artifact. The reference is
a UI that reads all of them, so it has no version: a single `/reference` route
(Scalar's documented layout) renders a `sources` dropdown over every entry in
`API_VERSIONS` and opens on `LATEST_API_VERSION`.

**Never add `app/api/{version}/reference/route.ts`.** It would render the same
page again with a different default, and reintroduce the stale-argument bug that
having one page eliminates. A new version appears in the dropdown automatically
once it is registered.

## Breaking change — a new path version

1. **Register the version** in `packages/shared/src/constants/index.ts`:
   append to `API_VERSIONS`, and point `LATEST_API_VERSION` at it.

2. **Add its doc metadata** in `apps/web/src/lib/openapi/versions.ts` — a new
   `API_VERSION_META` entry with `specVersion` and a `status`:
   - `preview` while the contract is incomplete. Leave `LATEST_API_VERSION` on
     the older version — the new one is served and listed in the dropdown, but
     `/reference` still opens on the contract devices actually speak.
   - `current` once it is the recommended target. Exactly one version holds
     this, and it must match `LATEST_API_VERSION`. Flip the previous version to
     `deprecated` with a `sunset` date at the same time.

3. **Add a path registrar** in `apps/web/src/lib/openapi/document.ts`: a new
   `registerV2Paths`, plus its `PATH_REGISTRARS` entry. Leave the older
   registrars untouched.

4. **Add the spec route** — `apps/web/src/app/api/v2/openapi.json/route.ts`,
   three lines:

   ```ts
   return Response.json(buildOpenApiDocument('v2')) // ← must match the folder
   ```

   That argument is the classic copy-paste bug: a stale `'v1'` serves v1 content
   at the v2 URL. No reference route is needed — `/reference` picks the version
   up from `API_VERSIONS`.

5. **Endpoint handlers** for the version's actual operations. Contract-shaped
   code (zod schema, response bodies) is per-version; mechanism (HMAC verify,
   replay window, service-role insert) is shared — do not fork it.

6. **Tests.** The suites in `apps/web/tests/unit/lib/openapi/`,
   `apps/web/tests/unit/app/api/versions.test.ts`, and
   `packages/shared/tests/unit/constants.test.ts` all iterate `API_VERSIONS`,
   so they cover a new version automatically. Nothing new to write.

7. **Docs.** Update `firmware/secrets.ini.example` and `firmware/README.md`
   only if devices are being migrated — an existing fleet stays pinned to its
   version deliberately.

## Retiring a version

Only once telemetry shows no traffic on it. Then delete `app/api/{version}/`,
its registrar, its `API_VERSION_META` entry, and its `API_VERSIONS` entry. It
disappears from the `/reference` dropdown automatically.

## Verify

```bash
yarn lint && yarn check-types && yarn test:unit && yarn build
```

Then exercise it — a green pipeline does not prove the docs render:

```bash
# one spec per version — check every entry in API_VERSIONS
curl -s localhost:3000/api/v1/openapi.json | jq '.info.version, .servers[0].url'
curl -sI localhost:3000/api-docs | head -3   # expect 308 → /reference
```

Open `/reference` in a browser and confirm the dropdown lists every entry in
`API_VERSIONS` and opens on `LATEST_API_VERSION`.
