import { API_RATE_LIMIT } from '@ws/shared'

import type { ApiKeyPrincipal } from '@/lib/api/keys/provider'
import { apiKeyHandlerOptions, withApiKey } from '@/lib/api/with-api-key'
import type { RateLimitResult } from '@/services/api-keys/rate-limit.service'
import { ServiceError } from '@/services/database/types'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const authenticate = jest.fn<Promise<ApiKeyPrincipal | null>, [string]>()
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({ authenticate: (t: string) => authenticate(t) }),
}))
const hit = jest.fn<Promise<RateLimitResult>, [unknown, unknown]>()
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: (s: unknown, p: unknown) => hit(s, p),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))

const TOKEN = `wsk_live_${'a'.repeat(43)}`
const RESET = new Date(Date.now() + 30_000).toISOString()
const request = (
  headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
  },
) => new Request('http://localhost/api/v1/stations', { headers })
const routeCtx = { params: Promise.resolve({}) }
const ok = jest.fn(async () => Response.json({ ok: true }))

beforeEach(() => {
  jest.clearAllMocks()
  authenticate.mockResolvedValue({ keyId: 'k1', userId: 'u1', scope: 'read' })
  hit.mockResolvedValue({ allowed: true, remaining: 59, resetAt: RESET })
})

describe('withApiKey', () => {
  it('answers 401 without a bearer token and never asks the provider', async () => {
    const res = await withApiKey({ scope: 'read', cors: true }, ok)(
      request({}),
      routeCtx,
    )
    expect(res.status).toBe(401)
    expect(authenticate).not.toHaveBeenCalled()
    expect(ok).not.toHaveBeenCalled()
  })

  it('gives an unknown key the same 401 body as a missing one', async () => {
    authenticate.mockResolvedValue(null)
    const handler = withApiKey({ scope: 'read', cors: false }, ok)
    const unknown = await handler(request(), routeCtx)
    const missing = await handler(request({}), routeCtx)
    expect(unknown.status).toBe(401)
    expect(await unknown.json()).toEqual(await missing.json())
  })

  it('passes the principal to the handler and sets rate-limit headers', async () => {
    const handler = jest.fn(async () => Response.json({ ok: true }))
    const res = await withApiKey({ scope: 'read', cors: true }, handler)(
      request(),
      routeCtx,
    )
    expect(res.headers.get('ratelimit-limit')).toBe(
      String(API_RATE_LIMIT.limit),
    )
    expect(res.headers.get('ratelimit-remaining')).toBe('59')
    expect(Number(res.headers.get('ratelimit-reset'))).toBeGreaterThan(28)
    expect(hit).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        bucket: 'key:k1',
        limit: API_RATE_LIMIT.limit,
        windowSeconds: API_RATE_LIMIT.windowSeconds,
      },
    )
    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        userId: 'u1',
        keyId: 'k1',
        scope: 'read',
        meta: {
          cors: true,
          rateLimit: {
            limit: API_RATE_LIMIT.limit,
            remaining: 59,
            resetAt: RESET,
          },
        },
      }),
      {},
    )
  })

  it('answers 429 with Retry-After when the key is over its limit', async () => {
    hit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: RESET })
    const res = await withApiKey({ scope: 'read', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).not.toBeNull()
    expect(ok).not.toHaveBeenCalled()
  })

  it('answers 403 INSUFFICIENT_SCOPE for a read key on a write route — after counting it', async () => {
    const res = await withApiKey({ scope: 'read_write', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    })
    expect(hit).toHaveBeenCalled()
    expect(ok).not.toHaveBeenCalled()
  })

  it('turns a handler failure into a bare 500 and logs the cause', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await withApiKey({ scope: 'read', cors: false }, async () => {
      throw new ServiceError('boom', '42P01', 'secret detail')
    })(request(), routeCtx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret detail')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('answers 500, not 401, when the provider itself fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    authenticate.mockRejectedValue(new ServiceError('db down'))
    const res = await withApiKey({ scope: 'read', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(500)
    log.mockRestore()
  })

  it('keeps CORS on error responses of GET routes so browsers can read them', async () => {
    const res = await withApiKey({ scope: 'read', cors: true }, ok)(
      request({}),
      routeCtx,
    )
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('429 wins over 403: a rate-limited read key on a write route', async () => {
    hit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: RESET })
    const res = await withApiKey({ scope: 'read_write', cors: false }, ok)(
      request(),
      routeCtx,
    )
    expect(res.status).toBe(429)
  })

  it('cors:false error responses carry no CORS headers', async () => {
    const res = await withApiKey({ scope: 'read', cors: false }, ok)(
      request({}),
      routeCtx,
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('a 500 after the rate-limit hit keeps the RateLimit headers', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    const res = await withApiKey({ scope: 'read', cors: false }, async () => {
      throw new Error('boom')
    })(request(), routeCtx)
    expect(res.status).toBe(500)
    expect(res.headers.get('ratelimit-remaining')).toBe('59')
    log.mockRestore()
  })

  it('stamps no-store, CORS and rate-limit headers onto a bare handler response', async () => {
    const res = await withApiKey({ scope: 'read', cors: true }, async () =>
      Response.json({}),
    )(request(), routeCtx)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('ratelimit-limit')).toBe(
      String(API_RATE_LIMIT.limit),
    )
  })

  it('exposes the options a handler was wrapped with', () => {
    const h = withApiKey({ scope: 'read_write', cors: false }, ok)
    expect(apiKeyHandlerOptions(h)).toEqual({
      scope: 'read_write',
      cors: false,
    })
    expect(apiKeyHandlerOptions(ok)).toBeUndefined()
  })
})
