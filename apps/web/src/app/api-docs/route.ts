import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

export const dynamic = 'force-dynamic'

/**
 * Legacy entry point. The reference now lives at `/reference` — one page
 * covering every version through its document dropdown. This keeps existing
 * links working: 308 rather than 302, so the method is preserved and clients
 * may cache it.
 */
export const GET = (request: Request): Response => {
  if (!areDocsEnabled()) return new Response('Not Found', { status: 404 })

  // `Response.redirect` rejects relative URLs; resolve against the request.
  return Response.redirect(new URL('/reference', request.url), 308)
}
