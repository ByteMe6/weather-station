import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { fetchMemberRole } from '@/services/devices/devices.service'
import { fetchUserIdByClerkId } from '@/services/users/users.service'

/**
 * Internal users.id for a Clerk user, or null if ensureCurrentUserAction never
 * ran. Throws ServiceError on a DB failure — callers map that to UNKNOWN
 * rather than reporting it as UNAUTHORIZED.
 */
export const resolveCurrentUserId = async (
  service: SupabaseClient<Database>,
  clerkUserId: string,
): Promise<string | null> => fetchUserIdByClerkId(service, { clerkUserId })

/**
 * The caller's role on a device, or null if not a member. Service role
 * bypasses RLS, so this is the explicit check. Throws ServiceError on failure.
 */
export const resolveMemberRole = async (
  service: SupabaseClient<Database>,
  userId: string,
  deviceId: string,
): Promise<DeviceRole | null> => fetchMemberRole(service, { deviceId, userId })
