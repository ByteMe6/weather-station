interface AuthResult {
  orgId: string | null
}
type AuthFn = (() => Promise<AuthResult>) & { protect: () => Promise<void> }
type Handler = (auth: AuthFn, req: Request) => Promise<Response | undefined>

const protect = jest.fn<Promise<void>, []>()
const authState: AuthResult = { orgId: null }
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
    authState.orgId = null
  })

  it('redirects /admin to the activation route when the active org is not the admin org', async () => {
    const res = await run('/admin')
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/admin/activate')
  })

  it('lets the admin org through', async () => {
    authState.orgId = 'org_admin123'
    expect(await run('/admin')).toBeUndefined()
  })

  it('never redirects the activation route itself (no loop)', async () => {
    expect(await run('/admin/activate')).toBeUndefined()
  })

  it('leaves non-admin routes alone', async () => {
    expect(await run('/dashboard')).toBeUndefined()
    expect(protect).toHaveBeenCalled()
  })
})
