import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

import { adminOrgId, isAdminOrg } from '@/lib/admin/org'
import { PUBLIC_ROUTES } from '@/lib/auth/public-routes'

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
// The one /admin path a non-active admin may reach: it activates the org (or
// 404s for everyone else). Without this exemption a genuine admin whose
// organisation is merely inactive could never get in.
const isAdminActivateRoute = createRouteMatcher(['/admin/activate'])
const ADMIN_ORG_CONFIGURED = (): boolean => adminOrgId() !== null

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
    // Layer 1 is a fast edge filter, not the authority: Clerk's cookie token
    // does not always carry `org_id` even for an active organisation, so a
    // redirect on every miss would bounce genuine admins in a loop. A matching
    // org short-circuits; anything else falls through to the layout, which
    // resolves membership through Clerk's API and 404s if it is not an admin.
    if (isAdminRoute(req) && !isAdminActivateRoute(req)) {
      const { userId, orgId } = await auth()
      if (!userId) {
        return NextResponse.redirect(new URL('/sign-in', req.url))
      }
      if (!isAdminOrg(orgId) && !ADMIN_ORG_CONFIGURED()) {
        // No admin organisation configured at all: nothing to reach.
        return NextResponse.redirect(new URL('/dashboard', req.url))
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
