import { GET } from '@/app/api-docs/route'

describe('GET /api-docs', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  const request = () => new Request('http://localhost:3000/api-docs')

  it('permanently redirects to the reference page', () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = GET(request())
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe(
      '/reference',
    )
  })

  it('returns 404 when docs are disabled rather than redirecting to a 404', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'false'
    const res = GET(request())
    expect(res.status).toBe(404)
  })
})
