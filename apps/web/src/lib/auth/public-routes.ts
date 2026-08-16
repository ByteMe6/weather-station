/**
 * Routes that never require a Clerk session. Everything else is protected
 * (PRD W1). Device ingest and docs must stay public: devices authenticate
 * with HMAC, not Clerk.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/privacy',
  '/api/v(.*)',
  '/api/webhooks(.*)',
  '/reference',
  '/api-docs',
] as const

const PUBLIC_MATCHERS = PUBLIC_ROUTES.map((p) => new RegExp(`^${p}$`))

export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_MATCHERS.some((re) => re.test(pathname))
