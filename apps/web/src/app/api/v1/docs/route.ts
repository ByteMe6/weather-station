import { areDocsEnabled } from '@/lib/openapi/docs-enabled'
import { createVersionedReference } from '@/lib/openapi/reference'

export const dynamic = 'force-dynamic'

const reference = createVersionedReference('v1')

export const GET = (): Response | Promise<Response> => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  return reference()
}
