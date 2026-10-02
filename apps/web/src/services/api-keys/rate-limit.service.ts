import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: string
}

/**
 * The limiter's bucket for one key. A string, not a foreign key, so it works
 * the same for our uuids and for Clerk's `ak_…` ids (spec §11).
 */
export const apiKeyRateLimitBucket = (keyId: string): string => `key:${keyId}`

export const hitRateLimit = async (
  supabase: SupabaseClient<Database>,
  params: { bucket: string; limit: number; windowSeconds: number },
): Promise<RateLimitResult> => {
  const { data, error } = await supabase.rpc('api_rate_limit_hit', {
    p_bucket: params.bucket,
    p_limit: params.limit,
    p_window_seconds: params.windowSeconds,
  })
  if (error) {
    throw new ServiceError(
      `Failed to apply rate limit: ${error.message}`,
      error.code,
      error.details,
    )
  }
  const row = data?.[0]
  if (!row) throw new ServiceError('Rate limiter returned no row')
  // rpc() rows cannot be aliased (CLAUDE.md) — mapped here.
  return {
    allowed: row.out_allowed,
    remaining: row.out_remaining,
    resetAt: row.out_reset_at,
  }
}

/** Cleans up a revoked key's counter so the row does not linger. */
export const deleteRateLimitBucket = async (
  supabase: SupabaseClient<Database>,
  params: { bucket: string },
): Promise<void> => {
  const { error } = await supabase
    .from('api_rate_limits')
    .delete()
    .eq('bucket', params.bucket)
  if (error) {
    throw new ServiceError(
      `Failed to delete rate-limit bucket: ${error.message}`,
      error.code,
      error.details,
    )
  }
}
