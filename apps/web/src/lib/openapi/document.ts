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
