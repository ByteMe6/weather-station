import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import {
  DEVICE_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'
import type { ApiVersion } from '@ws/shared'
import { z } from 'zod'

import { readingSchema } from '@/lib/ingest/reading-schema'
import { API_VERSION_META } from '@/lib/openapi/versions'

// Adds `.openapi()` to zod's prototype (retroactive — applies to readingSchema).
extendZodWithOpenApi(z)

const SIGNING_DESCRIPTION = [
  'HMAC-signed device ingest (write-only).',
  'msg = `${x-timestamp}.${rawBody}`; key = the 64-char hex device secret used',
  'as UTF-8 text; signature = lowercase hex in x-signature.',
  'x-timestamp is epoch-ms send time and must be within 300s of server time.',
].join(' ')

/**
 * The v1 operation set.
 *
 * Frozen by convention: once a path version ships, its registrar is never
 * edited. A breaking change gets a `registerV2Paths` and a new `v2` entry in
 * `PATH_REGISTRARS`, so v1's documented surface cannot drift out from under the
 * devices still calling it. Backwards-compatible additions to v1 are allowed
 * here, paired with a `specVersion` bump in `API_VERSION_META`.
 */
const registerV1Paths = (registry: OpenAPIRegistry): void => {
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
}

/**
 * The v2 operation set — preview, still being built out.
 *
 * Only `/health` exists so far; the ingest contract has not been designed yet,
 * which is why v2 is not `LATEST_API_VERSION`. Unlike a shipped registrar this
 * one is still editable — the freeze rule applies from the moment a version
 * becomes the recommended target.
 */
const registerV2Paths = (registry: OpenAPIRegistry): void => {
  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness probe',
    responses: { 200: { description: 'Service is alive' } },
  })
}

const PATH_REGISTRARS: Record<ApiVersion, (registry: OpenAPIRegistry) => void> =
  {
    v1: registerV1Paths,
    v2: registerV2Paths,
  }

/**
 * Build the OpenAPI document for one path version. `servers` scopes the
 * operation paths to that version's prefix, and `info.version` carries the
 * independent spec semver.
 */
export const buildOpenApiDocument = (version: ApiVersion) => {
  const registry = new OpenAPIRegistry()
  PATH_REGISTRARS[version](registry)

  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Weather Station Ingest API',
      version: API_VERSION_META[version].specVersion,
    },
    servers: [{ url: `/api/${version}` }],
  })
}
