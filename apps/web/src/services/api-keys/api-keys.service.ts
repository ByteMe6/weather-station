import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

import type { ApiKeyPrincipal, ApiKeySummary } from '@/lib/api/keys/provider'

/**
 * Aliased summary columns. key_hash is deliberately absent: it never leaves the
 * database except as the argument of api_key_authenticate().
 */
const SUMMARY_COLUMNS =
  'id, name, scope, hint:key_hint, createdAt:created_at, lastUsedAt:last_used_at, expiresAt:expires_at, revokedAt:revoked_at'

export const insertApiKey = async (
  supabase: SupabaseClient<Database>,
  params: {
    userId: string
    name: string
    scope: ApiKeyScope
    keyHash: string
    keyHint: string
    expiresAt: string | null
  },
): Promise<ApiKeySummary> => {
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      user_id: params.userId,
      name: params.name,
      scope: params.scope,
      key_hash: params.keyHash,
      key_hint: params.keyHint,
      expires_at: params.expiresAt,
    })
    .select(SUMMARY_COLUMNS)
    .single()

  if (error) {
    throw new ServiceError(
      `Failed to create API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The api_keys.scope check constraint guarantees scope ∈ ApiKeyScope.
  return data as ApiKeySummary
}

/** A user's keys, newest first, revoked and expired included. */
export const fetchApiKeysForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<ApiKeySummary[]> => {
  const { data, error } = await supabase
    .from('api_keys')
    .select(SUMMARY_COLUMNS)
    .eq('user_id', params.userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch API keys: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The api_keys.scope check constraint guarantees scope ∈ ApiKeyScope.
  return (data ?? []) as ApiKeySummary[]
}

/** Keys that still authenticate: not revoked and not expired. */
export const countActiveApiKeys = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<number> => {
  const { count, error } = await supabase
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', params.userId)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)

  if (error) {
    throw new ServiceError(
      `Failed to count API keys: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return count ?? 0
}

/**
 * Soft-revokes one of the user's keys. Chains .select() because PostgREST
 * reports no error for an update that matched nothing (CLAUDE.md): false means
 * not found, already revoked, or someone else's.
 */
export const revokeApiKey = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string; keyId: string },
): Promise<boolean> => {
  const { data, error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.keyId)
    .eq('user_id', params.userId)
    .is('revoked_at', null)
    .select('id')

  if (error) {
    throw new ServiceError(
      `Failed to revoke API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).length > 0
}

/** Principal for a key hash, or null for unknown / revoked / expired. */
export const authenticateApiKeyHash = async (
  supabase: SupabaseClient<Database>,
  params: { keyHash: string },
): Promise<ApiKeyPrincipal | null> => {
  const { data, error } = await supabase.rpc('api_key_authenticate', {
    p_key_hash: params.keyHash,
  })
  if (error) {
    throw new ServiceError(
      `Failed to authenticate API key: ${error.message}`,
      error.code,
      error.details,
    )
  }
  const row = data?.[0]
  if (!row) return null
  // rpc() rows cannot be aliased (CLAUDE.md); the out_ prefix keeps the OUT
  // names from shadowing api_keys columns inside the plpgsql body. The scope
  // check constraint guarantees out_scope ∈ ApiKeyScope.
  return {
    keyId: row.out_key_id,
    userId: row.out_user_id,
    scope: row.out_scope as ApiKeyScope,
  }
}
