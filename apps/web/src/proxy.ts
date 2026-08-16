import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

import { PUBLIC_ROUTES } from '@/lib/auth/public-routes'

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES])

/**
 * Next 16 proxy (formerly middleware): every non-public route requires a
 * Clerk session; signed-out visitors are sent to sign-in with redirect_url.
 */
export default clerkMiddleware(
  async (auth, req) => {
    if (!isPublicRoute(req)) {
      await auth.protect()
    }
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
