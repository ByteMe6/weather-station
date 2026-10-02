import { randomUUID } from 'node:crypto'

import type { ApiKeyOwner, ApiKeyProvider } from '@/lib/api/keys/provider'

export interface ProviderFixture {
  provider: ApiKeyProvider
  ownerA: ApiKeyOwner
  ownerB: ApiKeyOwner
}

/**
 * Behaviour every ApiKeyProvider must have (spec §5.1). Our provider runs it
 * today; a Clerk adapter must pass it unchanged before getApiKeyProvider() is
 * flipped (spec §11).
 */
export const describeApiKeyProvider = (
  name: string,
  setup: () => Promise<ProviderFixture>,
  teardown: () => Promise<void>,
): void => {
  describe(`ApiKeyProvider contract: ${name}`, () => {
    let f: ProviderFixture

    beforeEach(async () => {
      f = await setup()
    })
    afterEach(teardown)

    it('creates a key whose secret authenticates as its owner and scope', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'Grafana',
        scope: 'read',
        expiresInDays: 30,
      })
      expect(key).toMatchObject({
        name: 'Grafana',
        scope: 'read',
        lastUsedAt: null,
        revokedAt: null,
      })
      expect(
        key.hint === null || (key.hint !== '' && secret.endsWith(key.hint)),
      ).toBe(true)
      const days = (Date.parse(key.expiresAt ?? '') - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29.9)
      expect(days).toBeLessThanOrEqual(30)
      await expect(f.provider.authenticate(secret)).resolves.toEqual({
        keyId: key.id,
        userId: f.ownerA.userId,
        scope: 'read',
      })
    })

    it('creates a key without expiry when asked', async () => {
      const { key } = await f.provider.create(f.ownerA, {
        name: 'Forever',
        scope: 'read_write',
        expiresInDays: null,
      })
      expect(key.expiresAt).toBeNull()
    })

    it('lists only the owner’s keys', async () => {
      await f.provider.create(f.ownerA, {
        name: 'A',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.create(f.ownerB, {
        name: 'B',
        scope: 'read',
        expiresInDays: null,
      })
      const names = (await f.provider.list(f.ownerA)).map((k) => k.name)
      expect(names).toEqual(['A'])
    })

    it('counts only active keys', async () => {
      const first = await f.provider.create(f.ownerA, {
        name: 'one',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.create(f.ownerA, {
        name: 'two',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.revoke(f.ownerA, first.key.id)
      await expect(f.provider.countActive(f.ownerA)).resolves.toBe(1)
      await expect(f.provider.countActive(f.ownerB)).resolves.toBe(0)
    })

    it('refuses to revoke another owner’s key', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'mine',
        scope: 'read',
        expiresInDays: null,
      })
      await expect(f.provider.revoke(f.ownerB, key.id)).resolves.toBe(false)
      await expect(f.provider.authenticate(secret)).resolves.not.toBeNull()
    })

    it('stops authenticating a revoked key, and cannot revoke it twice', async () => {
      const { key, secret } = await f.provider.create(f.ownerA, {
        name: 'gone',
        scope: 'read',
        expiresInDays: null,
      })
      await expect(f.provider.revoke(f.ownerA, key.id)).resolves.toBe(true)
      await expect(f.provider.authenticate(secret)).resolves.toBeNull()
      await expect(f.provider.revoke(f.ownerA, key.id)).resolves.toBe(false)
    })

    it('rejects tokens it did not issue', async () => {
      await expect(f.provider.authenticate('garbage')).resolves.toBeNull()
    })

    it('rejects a token that is one character off a real key', async () => {
      const { secret } = await f.provider.create(f.ownerA, {
        name: 'near',
        scope: 'read',
        expiresInDays: null,
      })
      const last = secret.slice(-1)
      const nearMiss = `${secret.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`
      await expect(f.provider.authenticate(nearMiss)).resolves.toBeNull()
    })

    it('returns false when revoking an unknown or foreign-format id', async () => {
      await expect(f.provider.revoke(f.ownerA, randomUUID())).resolves.toBe(
        false,
      )
      await expect(f.provider.revoke(f.ownerA, 'ak_nope')).resolves.toBe(false)
    })

    it('lists newest first, revoked keys included', async () => {
      const first = await f.provider.create(f.ownerA, {
        name: 'first',
        scope: 'read',
        expiresInDays: null,
      })
      await new Promise((r) => setTimeout(r, 5))
      const second = await f.provider.create(f.ownerA, {
        name: 'second',
        scope: 'read',
        expiresInDays: null,
      })
      await f.provider.revoke(f.ownerA, first.key.id)
      const listed = await f.provider.list(f.ownerA)
      expect(listed.map((k) => k.id)).toEqual([second.key.id, first.key.id])
      expect(listed[1]?.revokedAt).not.toBeNull()
    })
  })
}
