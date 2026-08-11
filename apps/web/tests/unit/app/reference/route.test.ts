import { GET } from '@/app/reference/route'
import { createReference } from '@/lib/openapi/reference'

// Scalar's renderer is ESM-only and cannot load under the CommonJS transform.
// reference.test.ts covers the switcher config itself.
jest.mock('@/lib/openapi/reference', () => ({
  createReference: jest.fn(
    () => () =>
      new Response('<html lang="en"></html>', {
        headers: { 'content-type': 'text/html' },
      }),
  ),
}))

describe('GET /reference', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  // One page covers every version, so there is no per-version argument to get
  // wrong — the whole class of copy-paste version-binding bugs is gone.
  it('builds the reference once, with no version argument', () => {
    expect(createReference).toHaveBeenCalledWith()
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
