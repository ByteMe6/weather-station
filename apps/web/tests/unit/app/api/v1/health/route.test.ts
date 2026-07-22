import { GET } from '@/app/api/v1/health/route'

describe('GET /api/v1/health', () => {
  it('returns 200 with a liveness payload', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      uptime: number
      timestamp: string
    }
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(typeof body.timestamp).toBe('string')
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false)
  })
})
