import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface CurrentUser {
  id: string
  clerkUserId: string | null
  telegramId: number | null
  createdAt: string
}

/** Own `users` row (RLS: "users can view own profile"). Null before the first ensureCurrentUserAction. */
export const fetchCurrentUser = async (
  supabase: SupabaseClient<Database>,
): Promise<CurrentUser | null> => {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at',
    )
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch current user: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data
}

/**
 * Internal `users.id` for a Clerk user. Server path only in practice (the
 * service-role client bypasses RLS); null if ensureCurrentUserAction never ran.
 */
export const fetchUserIdByClerkId = async (
  supabase: SupabaseClient<Database>,
  params: { clerkUserId: string },
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('clerk_user_id', params.clerkUserId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to resolve user: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data?.id ?? null
}

/**
 * Right to erasure (MRP-40). Deleting the users row cascades device_users,
 * schedules and telegram_link_codes; maintain_device_status() flips a device
 * with no remaining members back to 'unregistered' (re-claimable). Readings
 * are device-scoped, not personal — they are kept (spec §4.9, privacy policy).
 * Service-role only: authenticated has no DELETE policy on users.
 */
export const deleteUserByClerkId = async (
  supabase: SupabaseClient<Database>,
  params: { clerkUserId: string },
): Promise<{ deletedUsers: number }> => {
  const { data, error } = await supabase
    .from('users')
    .delete()
    .eq('clerk_user_id', params.clerkUserId)
    .select('id')
  if (error) {
    throw new ServiceError(
      `Failed to erase user: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return { deletedUsers: data?.length ?? 0 }
}
