import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

/** Internal users.id for a Clerk user, or null if ensureCurrentUserAction never ran. */
export const resolveCurrentUserId = async (
  service: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<string | null> => {
  const { data } = await service
    .from('users')
    .select('id')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  return data?.id ?? null
}

/** The caller's role on a device, or null if not a member. Service role bypasses RLS, so this is the explicit check. */
export const resolveMemberRole = async (
  service: SupabaseClient<Database>,
  userId: string,
  deviceId: string,
): Promise<DeviceRole | null> => {
  const { data } = await service
    .from('device_users')
    .select('role')
    .eq('device_id', deviceId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.role as DeviceRole | undefined) ?? null
}
