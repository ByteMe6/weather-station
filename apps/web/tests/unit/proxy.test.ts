interface AuthResult {
  userId: string | null
  orgId: string | null
}
type AuthFn = (() => Promise<AuthResult>) & { protect: () => Promise<void> }
type Handler = (auth: AuthFn, req: Request) => Promise<Response | undefined>

const protect = jest.fn<Promise<void>, []>()
const authState: AuthResult = { userId: 'user_1', orgId: null }
let handler: Handler

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (fn: Handler) => {
    handler = fn
    return fn
  },
  createRouteMatcher: (patterns: string[]) => (req: Request) => {
    const path = new URL(req.url).pathname
    return patterns.some((p) =>
      p === '/admin(.*)'
        ? path.startsWith('/admin')
        : p === '/admin/activate'
          ? path === '/admin/activate'
          : path === p,
    )
  },
}))

import '@/proxy'

const auth: AuthFn = Object.assign(async () => authState, { protect })

const run = async (path: string) =>
  handler(auth, new Request(`http://localhost:3001${path}`))

describe('proxy admin gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ADMIN_ORG_ID = 'org_admin123'
    authState.userId = 'user_1'
    authState.orgId = null
  })

  it('lets the admin org straight through', async () => {
    authState.orgId = 'org_admin123'
    expect(await run('/admin')).toBeUndefined()
  })

  it('falls through to the layout when the cookie has no active org', async () => {
    // Clerk's cookie token can lack org_id even for an active organisation, so
    // the edge must not deny on that alone — the layout resolves membership.
    authState.orgId = null
    expect(await run('/admin')).toBeUndefined()
  })

  it('sends a signed-out visitor to sign-in', async () => {
    authState.userId = null
    const res = await run('/admin')
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/sign-in')
  })

  it('sends everyone to the dashboard when no admin org is configured', async () => {
    delete process.env.ADMIN_ORG_ID
    const res = await run('/admin')
    expect(res?.headers.get('location')).toContain('/dashboard')
  })

  it('never redirects the activation route itself (no loop)', async () => {
    expect(await run('/admin/activate')).toBeUndefined()
  })

  it('leaves non-admin routes alone', async () => {
    expect(await run('/dashboard')).toBeUndefined()
    expect(protect).toHaveBeenCalled()
  })
})
