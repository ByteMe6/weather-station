import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { isAdminOrg } from '@/lib/admin/org'
import { PUBLIC_ROUTES } from '@/lib/auth/public-routes'

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
// The one /admin path a non-active admin may reach: it activates the org (or
// 404s for everyone else). Without this exemption a genuine admin whose
// organisation is merely inactive could never get in.
const isAdminActivateRoute = createRouteMatcher(['/admin/activate'])

/**
 * Next 16 proxy (formerly middleware): every non-public route requires a
 * Clerk session; signed-out visitors are sent to sign-in with redirect_url.
 *
 * Layer 1 of the admin gate — the console is unreachable unless the session's
 * ACTIVE organisation is ADMIN_ORG_ID. The layout and every admin server
 * action repeat the check; none of them trusts this one.
 */
export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect()
    }
    if (isAdminRoute(req) && !isAdminActivateRoute(req)) {
      const { orgId } = await auth()
      if (!isAdminOrg(orgId)) {
        return NextResponse.redirect(new URL('/admin/activate', req.url))
      }
    }
    return undefined
  },
  // Routing lives in code (mirrored by ClerkProvider props) so no per-environment env vars can drift.
  { signInUrl: '/sign-in', signUpUrl: '/sign-up' },
)

export const config = {
  matcher: [
    // Skip Next internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|avif)).*)',
    '/(api|trpc)(.*)',
  ],
}
