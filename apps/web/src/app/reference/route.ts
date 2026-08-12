import { areDocsEnabled } from '@/lib/openapi/docs-enabled'
import { createReference } from '@/lib/openapi/reference'

export const dynamic = 'force-dynamic'

// Top-level, matching Scalar's documented `app/reference/route.ts` layout. It
// covers every version at once via the document dropdown — see createReference.
const reference = createReference()

export const GET = (): Response | Promise<Response> => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  return reference()
}
