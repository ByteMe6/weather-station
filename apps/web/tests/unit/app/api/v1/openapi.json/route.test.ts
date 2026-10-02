import { GET } from '@/app/api/v1/openapi.json/route'

describe('GET /api/v1/openapi.json', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('serves the OpenAPI document when docs are enabled', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    const res = await GET()
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      openapi: string
      paths: Record<string, unknown>
      servers: { url: string }[]
    }
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths['/readings']).toBeDefined()
    expect(doc.paths['/health']).toBeDefined()
    expect(doc.servers[0]?.url).toBe('/api/v1')
  })

  it('returns 404 when docs are disabled', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'false'
    const res = await GET()
    expect(res.status).toBe(404)
  })
})
