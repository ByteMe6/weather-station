import { createHash } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import {
  authenticateApiKeyHash,
  countActiveApiKeys,
  fetchApiKeysForUser,
  insertApiKey,
  revokeApiKey,
} from '@/services/api-keys/api-keys.service'
import {
  deleteRateLimitBucket,
  hitRateLimit,
} from '@/services/api-keys/rate-limit.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_apikeys_a'
const CLERK_B = 'user_inttest_apikeys_b'
const BUCKET = 'key:inttest-bucket'
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
  await db.from('api_rate_limits').delete().eq('bucket', BUCKET)
})

describe('api-keys service (integration)', () => {
  it('inserts, lists, authenticates and revokes a key', async () => {
    const userId = await makeUser(CLERK_A)
    const created = await insertApiKey(db, {
      userId,
      name: 'Grafana',
      scope: 'read',
      keyHash: hash('secret-1'),
      keyHint: 'et-1',
      expiresAt: null,
    })
    expect(created).toMatchObject({
      name: 'Grafana',
      scope: 'read',
      hint: 'et-1',
      lastUsedAt: null,
      expiresAt: null,
      revokedAt: null,
    })

    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('secret-1') }),
    ).resolves.toEqual({ keyId: created.id, userId, scope: 'read' })
    const [listed] = await fetchApiKeysForUser(db, { userId })
    expect(listed).toBeDefined()
    expect(listed?.lastUsedAt).toEqual(expect.any(String))

    await expect(revokeApiKey(db, { userId, keyId: created.id })).resolves.toBe(
      true,
    )
    await expect(revokeApiKey(db, { userId, keyId: created.id })).resolves.toBe(
      false,
    )
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('secret-1') }),
    ).resolves.toBeNull()
  })

  it('counts only active keys and never another user’s', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await insertApiKey(db, {
      userId: a,
      name: 'live',
      scope: 'read',
      keyHash: hash('a-live'),
      keyHint: 'live',
      expiresAt: null,
    })
    await insertApiKey(db, {
      userId: a,
      name: 'expired',
      scope: 'read',
      keyHash: hash('a-expired'),
      keyHint: 'expd',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await insertApiKey(db, {
      userId: b,
      name: 'b',
      scope: 'read_write',
      keyHash: hash('b-live'),
      keyHint: 'blve',
      expiresAt: null,
    })

    await expect(countActiveApiKeys(db, { userId: a })).resolves.toBe(1)
    expect(await fetchApiKeysForUser(db, { userId: a })).toHaveLength(2)
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('a-expired') }),
    ).resolves.toBeNull()
  })

  it('refuses to revoke another user’s key', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    const created = await insertApiKey(db, {
      userId: a,
      name: 'mine',
      scope: 'read',
      keyHash: hash('a-mine'),
      keyHint: 'mine',
      expiresAt: null,
    })
    await expect(
      revokeApiKey(db, { userId: b, keyId: created.id }),
    ).resolves.toBe(false)
    await expect(
      authenticateApiKeyHash(db, { keyHash: hash('a-mine') }),
    ).resolves.not.toBeNull()
  })

  it('rate-limits per bucket and resets when the bucket is deleted', async () => {
    const hit = () =>
      hitRateLimit(db, { bucket: BUCKET, limit: 2, windowSeconds: 3600 })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 1 })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 0 })
    const refused = await hit()
    expect(refused).toMatchObject({ allowed: false, remaining: 0 })
    expect(Date.parse(refused.resetAt)).toBeGreaterThan(Date.now())

    await deleteRateLimitBucket(db, { bucket: BUCKET })
    await expect(hit()).resolves.toMatchObject({ allowed: true, remaining: 1 })
  })
})
