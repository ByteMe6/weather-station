import { LATEST_API_VERSION } from '@ws/shared'

import { GET } from '@/app/api-docs/route'

describe('GET /api-docs', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  const request = () => new Request('http://localhost:3000/api-docs')

  it('permanently redirects to the current version docs', () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = GET(request())
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe(
      `/api/${LATEST_API_VERSION}/reference`,
    )
  })

  it('returns 404 in production rather than redirecting to a 404', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    const res = GET(request())
    expect(res.status).toBe(404)
  })
})
