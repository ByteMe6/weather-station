import { GET } from '@/app/api/v2/reference/route'
import { createVersionedReference } from '@/lib/openapi/reference'

// Scalar's renderer is ESM-only and cannot load under the CommonJS transform.
// See tests/unit/app/api/v1/reference/route.test.ts for the same rationale.
jest.mock('@/lib/openapi/reference', () => ({
  createVersionedReference: jest.fn(
    () => () =>
      new Response('<html lang="en"></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  ),
}))

describe('GET /api/v2/reference', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  // Guards the copy-paste bug: this route was cloned from v1, and a stale 'v1'
  // here would serve v1 docs at the v2 URL.
  it('binds the reference to its own path version', () => {
    expect(createVersionedReference).toHaveBeenCalledWith('v2')
  })

  it('renders the reference page when docs are enabled', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns 404 in production', async () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(404)
  })
})
