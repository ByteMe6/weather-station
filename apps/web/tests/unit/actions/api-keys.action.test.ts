import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from '@/actions/api-keys.action'
import type { ApiKeyProvider, ApiKeySummary } from '@/lib/api/keys/provider'

const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const ensure = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/users.action', () => ({
  ensureCurrentUserAction: () => ensure(),
}))
const resolveUser = jest.fn<Promise<string | null>, [unknown, string]>()
jest.mock('@/actions/_helpers', () => ({
  resolveCurrentUserId: (s: unknown, c: string) => resolveUser(s, c),
}))
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const provider = {
  authenticate: jest.fn(),
  create: jest.fn(),
  list: jest.fn(),
  countActive: jest.fn(),
  revoke: jest.fn(),
} satisfies Record<keyof ApiKeyProvider, jest.Mock>
jest.mock('@/lib/api/keys', () => ({ getApiKeyProvider: () => provider }))
const deleteBucket = jest.fn<Promise<void>, [unknown, { bucket: string }]>()
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
  deleteRateLimitBucket: (s: unknown, p: { bucket: string }) =>
    deleteBucket(s, p),
}))

const OWNER = { userId: 'u1', clerkUserId: 'user_1' }
const SUMMARY: ApiKeySummary = {
  id: 'k1',
  name: 'Grafana',
  scope: 'read',
  hint: 'a9Xk',
  createdAt: 't',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  auth.mockResolvedValue({ userId: 'user_1' })
  ensure.mockResolvedValue({ ok: true, data: { userId: 'u1' } })
  resolveUser.mockResolvedValue('u1')
  provider.countActive.mockResolvedValue(0)
  provider.create.mockResolvedValue({ key: SUMMARY, secret: 'wsk_live_x' })
  provider.list.mockResolvedValue([SUMMARY])
  provider.revoke.mockResolvedValue(true)
  deleteBucket.mockResolvedValue(undefined)
})

describe('createApiKeyAction', () => {
  const input = { name: ' Grafana ', scope: 'read' as const, expiresInDays: 90 }

  it('requires a session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED',
    })
    expect(provider.create).not.toHaveBeenCalled()
  })

  it('counts active keys for the caller', async () => {
    await createApiKeyAction(input)
    expect(provider.countActive).toHaveBeenCalledWith(OWNER)
  })

  it('creates through the provider and returns the secret once', async () => {
    await expect(createApiKeyAction(input)).resolves.toEqual({
      ok: true,
      data: { key: SUMMARY, secret: 'wsk_live_x' },
    })
    expect(provider.create).toHaveBeenCalledWith(OWNER, {
      name: 'Grafana',
      scope: 'read',
      expiresInDays: 90,
    })
  })

  it.each([
    ['empty name', { ...input, name: '  ' }, 'name'],
    ['unknown scope', { ...input, scope: 'admin' as never }, 'scope'],
    ['unoffered expiry', { ...input, expiresInDays: 7 }, 'expiresInDays'],
  ])('rejects %s', async (_label, bad, field) => {
    const res = await createApiKeyAction(bad)
    expect(res).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(!res.ok && res.fieldErrors?.[field]).toBeTruthy()
  })

  it('accepts a key that never expires', async () => {
    await createApiKeyAction({ ...input, expiresInDays: null })
    expect(provider.create).toHaveBeenCalledWith(
      OWNER,
      expect.objectContaining({ expiresInDays: null }),
    )
  })

  it('refuses an eleventh active key', async () => {
    provider.countActive.mockResolvedValue(10)
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'KEY_LIMIT',
    })
    expect(provider.create).not.toHaveBeenCalled()
  })

  it('maps a provider failure to UNKNOWN', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    provider.create.mockRejectedValue(new Error('db down'))
    await expect(createApiKeyAction(input)).resolves.toMatchObject({
      ok: false,
      code: 'UNKNOWN',
    })
    log.mockRestore()
  })
})

describe('listApiKeysAction', () => {
  it('requires a session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(listApiKeysAction()).resolves.toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED',
    })
    expect(provider.list).not.toHaveBeenCalled()
  })

  it('lists the caller’s keys', async () => {
    await expect(listApiKeysAction()).resolves.toEqual({
      ok: true,
      data: [SUMMARY],
    })
    expect(provider.list).toHaveBeenCalledWith(OWNER)
  })

  it('returns an empty list for a user without a users row', async () => {
    resolveUser.mockResolvedValue(null)
    await expect(listApiKeysAction()).resolves.toEqual({ ok: true, data: [] })
    expect(provider.list).not.toHaveBeenCalled()
  })
})

describe('revokeApiKeyAction', () => {
  it('requires a session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED',
    })
    expect(provider.revoke).not.toHaveBeenCalled()
  })

  it.each([
    ['empty', ''],
    ['oversize', 'x'.repeat(101)],
  ])('rejects an %s keyId', async (_label, keyId) => {
    await expect(revokeApiKeyAction({ keyId })).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(provider.revoke).not.toHaveBeenCalled()
  })

  it('answers NOT_FOUND for a user without a users row', async () => {
    resolveUser.mockResolvedValue(null)
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(provider.revoke).not.toHaveBeenCalled()
  })

  it('maps a provider failure to UNKNOWN', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    provider.revoke.mockRejectedValue(new Error('db down'))
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toMatchObject({
      ok: false,
      code: 'UNKNOWN',
    })
    expect(deleteBucket).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('revokes the caller’s key', async () => {
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(provider.revoke).toHaveBeenCalledWith(OWNER, 'k1')
    expect(deleteBucket).toHaveBeenCalledWith(
      { __brand: 'service' },
      { bucket: 'key:k1' },
    )
  })

  // The key is already revoked at this point; a limiter hiccup must not turn
  // that into a reported failure (a retry would then say "not found").
  it('still reports success when the bucket cleanup fails', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    deleteBucket.mockRejectedValue(new Error('db down'))
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('answers NOT_FOUND when the provider revoked nothing', async () => {
    provider.revoke.mockResolvedValue(false)
    await expect(revokeApiKeyAction({ keyId: 'k1' })).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(deleteBucket).not.toHaveBeenCalled()
  })
})
