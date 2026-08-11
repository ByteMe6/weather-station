import { GET } from '@/app/api/v1/docs/route'
import { createVersionedReference } from '@/lib/openapi/reference'

// Scalar's renderer is ESM-only and cannot load under the CommonJS transform.
// Stubbing our own wrapper keeps this suite on the route's real logic — the
// docs gate and the version binding — while reference.test.ts covers the
// switcher config itself.
jest.mock('@/lib/openapi/reference', () => ({
  createVersionedReference: jest.fn(
    () => () =>
      new Response('<html lang="en"></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  ),
}))

describe('GET /api/v1/docs', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  // The likeliest mistake when adding v2 is copying this route and leaving the
  // argument at 'v1', which would silently serve v1 docs at the v2 URL.
  it('binds the reference to its own path version', () => {
    expect(createVersionedReference).toHaveBeenCalledWith('v1')
  })

  it('renders the reference page when docs are enabled', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('returns 404 in production', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(404)
  })
})
