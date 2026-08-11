import { areDocsEnabled } from '@/lib/openapi/docs-enabled'
import { buildOpenApiDocument } from '@/lib/openapi/document'

export const dynamic = 'force-dynamic'

export const GET = async (): Promise<Response> => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  return Response.json(buildOpenApiDocument('v2'))
}
