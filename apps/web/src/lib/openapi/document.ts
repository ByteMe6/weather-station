import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi'
import {
  API_AGGREGATE_INTERVALS,
  API_READINGS_PAGE_DEFAULT,
  API_READINGS_PAGE_MAX,
  DEVICE_ID_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'
import type { ApiVersion } from '@ws/shared'
import { z } from 'zod'

import {
  aggregateQuerySchema,
  readingsQuerySchema,
  stationPatchSchema,
} from '@/lib/api/schemas'
import { readingSchema } from '@/lib/ingest/reading-schema'
import {
  apiErrorDocSchema,
  bucketDocSchema,
  readingDocSchema,
  stationDocSchema,
} from '@/lib/openapi/station-schemas'
import { API_VERSION_META } from '@/lib/openapi/versions'

// Adds `.openapi()` to zod's prototype (retroactive — applies to readingSchema).
extendZodWithOpenApi(z)

const SIGNING_DESCRIPTION = [
  'HMAC-signed device ingest (write-only).',
  'msg = `${x-timestamp}.${rawBody}`; key = the 64-char hex device secret used',
  'as UTF-8 text; signature = lowercase hex in x-signature.',
  'x-timestamp is epoch-ms send time and must be within 300s of server time.',
].join(' ')

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
      200: {
        description: 'The station',
        content: json(z.object({ data: Station })),
      },
      ...errors(401, 404, 429),
    },
  })

  registry.registerPath({
    method: 'patch',
    path: '/stations/{stationId}',
    summary: 'Edit station details',
    description:
      'Owners and editors only, with a read & write key. Omitted fields keep their value; null clears. Latitude and longitude are set or cleared together. Not callable from browsers (no CORS). At least one field is required.',
    security,
    request: {
      params,
      body: { required: true, content: json(stationPatchSchema) },
    },
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
        description:
          'The most recent reading, or null if the station never reported',
        content: json(z.object({ data: z.union([Reading, z.null()]) })),
      },
      ...errors(401, 404, 429),
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/stations/{stationId}/readings',
    summary: 'Raw readings (paginated)',
    description: `Ascending by time. Default window: the last 24 h; at most 31 days per request. \`limit\`: 1–${API_READINGS_PAGE_MAX} rows, default ${API_READINGS_PAGE_DEFAULT}. When \`nextCursor\` is set, pass it back as \`cursor\` with the same from/to for the next page.`,
    security,
    request: { params, query: readingsQuerySchema },
    responses: {
      200: {
        description: 'One page of readings',
        content: json(
          z.object({
            data: z.array(Reading),
            nextCursor: z.string().nullable(),
          }),
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
}

const PATH_REGISTRARS: Record<ApiVersion, (registry: OpenAPIRegistry) => void> =
  {
    v1: registerV1Paths,
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
      title: 'Weather Station API',
      version: API_VERSION_META[version].specVersion,
    },
    servers: [{ url: `/api/${version}` }],
  })
}
