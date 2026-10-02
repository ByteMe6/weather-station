import 'server-only'

import { createServiceRoleClient } from '@ws/supabase-db'

import {
  generateOwnKey,
  hashOwnKey,
  isOwnKeyFormat,
  ownKeyHint,
} from './own-key-format'
import type { ApiKeyProvider } from './provider'

import {
  authenticateApiKeyHash,
  countActiveApiKeys,
  fetchApiKeysForUser,
  insertApiKey,
  revokeApiKey,
} from '@/services/api-keys/api-keys.service'

const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Keys stored hashed in public.api_keys (spec §3.1). */
export const ownApiKeyProvider: ApiKeyProvider = {
  authenticate: async (token) => {
    if (!isOwnKeyFormat(token)) return null
    return authenticateApiKeyHash(createServiceRoleClient(), {
      keyHash: hashOwnKey(token),
    })
  },

  create: async (owner, input) => {
    const secret = generateOwnKey()
    const key = await insertApiKey(createServiceRoleClient(), {
      userId: owner.userId,
      name: input.name,
      scope: input.scope,
      keyHash: hashOwnKey(secret),
      keyHint: ownKeyHint(secret),
      expiresAt:
        input.expiresInDays === null
          ? null
          : new Date(Date.now() + input.expiresInDays * DAY_MS).toISOString(),
    })
    return { key, secret }
  },

  list: async (owner) =>
    fetchApiKeysForUser(createServiceRoleClient(), { userId: owner.userId }),

  countActive: async (owner) =>
    countActiveApiKeys(createServiceRoleClient(), { userId: owner.userId }),

  revoke: async (owner, keyId) => {
    // Our ids are uuids; anything else cannot be ours, and passing it on would
    // turn a "not found" into a Postgres 22P02.
    if (!UUID.test(keyId)) return false
    return revokeApiKey(createServiceRoleClient(), {
      userId: owner.userId,
      keyId,
    })
  },
}
