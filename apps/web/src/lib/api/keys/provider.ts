import type { ApiKeyScope } from '@ws/shared'

/**
 * The seam between "where API keys live" and everything else (spec §5.1).
 * Routes, withApiKey, the limiter, the actions and the Settings UI depend on
 * this and never on an implementation; getApiKeyProvider() picks one.
 */

export interface ApiKeyPrincipal {
  /** Opaque: our uuid today, a Clerk `ak_…` id after a swap. */
  keyId: string
  /** Internal users.id — an implementation keyed by Clerk id maps it. */
  userId: string
  scope: ApiKeyScope
}

export interface ApiKeySummary {
  id: string
  name: string
  scope: ApiKeyScope
  /**
   * Display tail of the secret, e.g. "a9Xk"; null when the provider cannot
   * report it (Clerk's list returns no secret tail).
   */
  hint: string | null
  createdAt: string
  /** null when never used — or when the provider cannot report it. */
  lastUsedAt: string | null
  expiresAt: string | null
  /**
   * A provider without a revocation timestamp may approximate it (e.g. Clerk
   * `updatedAt` when `revoked`).
   */
  revokedAt: string | null
}

/** Both ids, so either implementation has what it keys on. */
export interface ApiKeyOwner {
  userId: string
  clerkUserId: string
}

export interface ApiKeyCreateInput {
  name: string
  scope: ApiKeyScope
  /** null = never expires. */
  expiresInDays: number | null
}

export interface ApiKeyProvider {
  /**
   * Principal for a token, or null for every "not a valid key" case (unknown,
   * malformed, revoked, expired). Throws only on infrastructure failure, so an
   * outage is a 500 and never a misleading 401.
   */
  authenticate: (token: string) => Promise<ApiKeyPrincipal | null>
  /** The secret is returned exactly once, here. */
  create: (
    owner: ApiKeyOwner,
    input: ApiKeyCreateInput,
  ) => Promise<{ key: ApiKeySummary; secret: string }>
  /** Newest first, revoked and expired included. */
  list: (owner: ApiKeyOwner) => Promise<ApiKeySummary[]>
  countActive: (owner: ApiKeyOwner) => Promise<number>
  /** false when the key does not exist, is already revoked, or is not the owner's. */
  revoke: (owner: ApiKeyOwner, keyId: string) => Promise<boolean>
}
