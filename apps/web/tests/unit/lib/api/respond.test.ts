import { apiError, apiJson, preflight, withMeta } from '@/lib/api/respond'

const RESET = new Date(Date.now() + 30_000).toISOString()

describe('API responses', () => {
  it('never lets a response be cached', () => {
    expect(apiJson({}, { cors: false }).headers.get('cache-control')).toBe(
      'no-store',
    )
  })

  it('adds read-only CORS only when asked', () => {
    const open = apiJson({}, { cors: true })
    expect(open.headers.get('access-control-allow-origin')).toBe('*')
    expect(open.headers.get('access-control-allow-methods')).toBe(
      'GET, OPTIONS',
    )
    expect(open.headers.get('access-control-allow-credentials')).toBeNull()
    expect(
      apiJson({}, { cors: false }).headers.get('access-control-allow-origin'),
    ).toBeNull()
  })

  it('reports rate-limit state in seconds', () => {
    const res = apiJson(
      {},
      { cors: false, rateLimit: { limit: 60, remaining: 7, resetAt: RESET } },
    )
    expect(res.headers.get('ratelimit-limit')).toBe('60')
    expect(res.headers.get('ratelimit-remaining')).toBe('7')
    expect(Number(res.headers.get('ratelimit-reset'))).toBeGreaterThan(28)
  })

  it('builds the error envelope with the code’s status and default message', async () => {
    const res = apiError('NOT_FOUND', { cors: true })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Station not found' },
    })
  })

  it('carries field errors and a custom message', async () => {
    const res = apiError(
      'INVALID_INPUT',
      { cors: false },
      { message: 'Nope', fieldErrors: { from: 'bad' } },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'Nope',
        fieldErrors: { from: 'bad' },
      },
    })
  })

  it('adds Retry-After to a 429', () => {
    const res = apiError('RATE_LIMITED', {
      cors: false,
      rateLimit: { limit: 60, remaining: 0, resetAt: RESET },
    })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(28)
  })

  it('never sends Retry-After below 1 second', () => {
    const res = apiError('RATE_LIMITED', {
      cors: false,
      rateLimit: {
        limit: 60,
        remaining: 0,
        resetAt: new Date(Date.now() - 5000).toISOString(),
      },
    })
    expect(res.headers.get('retry-after')).toBe('1')
    expect(res.headers.get('ratelimit-reset')).toBe('0')
  })

  it('withMeta stamps a bare response with no-store, CORS and rate-limit headers', () => {
    const res = withMeta(Response.json({}), {
      cors: true,
      rateLimit: { limit: 60, remaining: 3, resetAt: RESET },
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('ratelimit-remaining')).toBe('3')
  })

  it('withMeta works on a response with immutable headers', () => {
    const res = withMeta(Response.redirect('http://localhost/x', 302), {
      cors: false,
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('answers preflight with 204 and GET-only CORS', () => {
    const res = preflight()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBe(
      'Authorization',
    )
    expect(res.headers.get('access-control-allow-methods')).not.toContain(
      'PATCH',
    )
  })
})
