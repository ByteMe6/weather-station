import { ApiReference } from '@scalar/nextjs-api-reference'

import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

// Scalar renders a self-contained HTML page that fetches the spec at request
// time — no client-side React hydration, which is why it works here where
// swagger-ui-react did not (its apidom OpenAPI-3.1 resolver breaks under
// Turbopack: "OpenApi3_1Element.refract is not a function").
const reference = ApiReference({ url: '/api/v1/openapi.json' })

export const GET = (): Response | Promise<Response> => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })
  return reference()
}
