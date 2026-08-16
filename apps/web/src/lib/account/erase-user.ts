import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'

/**
 * Right to erasure (MRP-40). Deleting the users row cascades device_users,
 * schedules and telegram_link_codes; maintain_device_status() flips a device
 * with no remaining members back to 'unregistered' (re-claimable). Readings
 * are device-scoped, not personal — they are kept (spec §4.9, privacy policy).
 */
export const eraseUserByClerkId = async (
  service: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<{ deletedUsers: number }> => {
  const { data, error } = await service
    .from('users')
    .delete()
    .eq('clerk_user_id', clerkUserId)
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
