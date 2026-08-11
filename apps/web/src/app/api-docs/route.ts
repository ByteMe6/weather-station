import { LATEST_API_VERSION } from '@ws/shared'

import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

/**
 * Legacy entry point. The reference pages now live beside the spec they
 * document, at `/api/{version}/docs`, so each version's docs retire with it.
 * This keeps existing links working by forwarding to the current version —
 * 308 rather than 302 so the method is preserved and clients may cache it.
 */
export const GET = (request: Request): Response => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })

  // `Response.redirect` rejects relative URLs; resolve against the request.
  return Response.redirect(
    new URL(`/api/${LATEST_API_VERSION}/docs`, request.url),
    308,
  )
}
