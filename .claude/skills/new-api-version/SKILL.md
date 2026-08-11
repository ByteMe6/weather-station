---
name: new-api-version
description: Add or change an HTTP API version the project way — major-only path versions, semver in OpenAPI info.version, a frozen path registrar per version, and versioned docs at /api/{version}/docs.
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
   and not discipline.

## Backwards-compatible change to a live version

A new optional field, a new documented response, a corrected description:

1. Bump `specVersion` in `apps/web/src/lib/openapi/versions.ts`
   (`1.0.0` → `1.0.1` for a fix, `1.1.0` for an addition).
2. Update that version's `registerVxPaths` in
   `apps/web/src/lib/openapi/document.ts` — allowed here, since nothing breaks.
3. Nothing else moves. The path, the routes, and the firmware URL stay put.

## Breaking change — a new path version

1. **Register the version** in `packages/shared/src/constants/index.ts`:
   append to `API_VERSIONS`, and point `LATEST_API_VERSION` at it.

2. **Add its doc metadata** in `apps/web/src/lib/openapi/versions.ts` — a new
   `API_VERSION_META` entry with `specVersion` and `status: 'current'`. Flip the
   previous version to `status: 'deprecated'` and give it a `sunset` date.

3. **Add a path registrar** in `apps/web/src/lib/openapi/document.ts`: a new
   `registerV2Paths`, plus its `PATH_REGISTRARS` entry. Leave the older
   registrars untouched.

4. **Add the routes** under `apps/web/src/app/api/v2/` — each is a few lines:

   ```ts
   // app/api/v2/docs/route.ts
   const reference = createVersionedReference('v2') // ← must match the folder
   ```

   ```ts
   // app/api/v2/openapi.json/route.ts
   return Response.json(buildOpenApiDocument('v2')) // ← must match the folder
   ```

   Both arguments are the classic copy-paste bug: a stale `'v1'` here serves v1
   content at a v2 URL. The route tests assert this binding — keep them.

5. **Endpoint handlers** for the version's actual operations. Contract-shaped
   code (zod schema, response bodies) is per-version; mechanism (HMAC verify,
   replay window, service-role insert) is shared — do not fork it.

6. **Tests.** The suites in `apps/web/tests/unit/lib/openapi/` and
   `packages/shared/tests/unit/constants.test.ts` iterate `API_VERSIONS`, so
   they cover a new version automatically. Add a
   `tests/unit/app/api/v2/docs/route.test.ts` asserting the version binding.

7. **Docs.** Update `firmware/secrets.ini.example` and `firmware/README.md`
   only if devices are being migrated — an existing fleet stays pinned to its
   version deliberately.

## Retiring a version

Only once telemetry shows no traffic on it. Then delete `app/api/{version}/`,
its registrar, its `API_VERSION_META` entry, and its `API_VERSIONS` entry — the
docs page goes with the folder.

## Verify

```bash
yarn lint && yarn check-types && yarn test:unit && yarn build
```

Then exercise it — a green pipeline does not prove the docs render:

```bash
curl -s localhost:3000/api/v1/openapi.json | jq '.info.version, .servers[0].url'
curl -sI localhost:3000/api-docs | head -3   # expect 308 → /api/{latest}/docs
```

Open `/api/{version}/docs` in a browser and confirm the version dropdown lists
every entry in `API_VERSIONS` and defaults to the page's own version.
