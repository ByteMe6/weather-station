import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole, DeviceStatus } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface MyDevice {
  deviceId: string
  role: DeviceRole
  addedAt: string
  device: {
    status: DeviceStatus
    createdAt: string
    label: string | null
    address: string | null
  } | null
}

/** Display name for a station: the owner's nickname, else the id. */
export const deviceDisplayName = (d: MyDevice): string =>
  d.device?.label ?? d.deviceId

/** Devices the current user is linked to (RLS on device_users + devices). Oldest link first. */
export const fetchMyDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(
      'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at, label, address )',
    )
    .order('added_at', { ascending: true })

  if (error) {
    throw new ServiceError(
      `Failed to fetch devices: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
  return (data ?? []) as MyDevice[]
}

export interface DeviceMember {
  userId: string
  role: DeviceRole
  addedAt: string
  /** Last 4 characters of the member's Clerk user id — the DB never sends more. */
  clerkTail: string | null
  /** Last 4 digits of the member's Telegram id, likewise. */
  telegramTail: string | null
}

/**
 * Members of a device via the `device_members` RPC (SECURITY DEFINER): owners
 * get every member, other members only themselves, non-members nothing.
 * Identifiers arrive pre-masked. rpc() rows cannot be aliased in the query,
 * so — like fetchReadingsBucketed — this is one of the two places rows are
 * mapped by hand.
 */
export const fetchDeviceMembers = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<DeviceMember[]> => {
  const { data, error } = await supabase.rpc('device_members', {
    p_device_id: params.deviceId,
  })

  if (error) {
    throw new ServiceError(
      `Failed to fetch device members: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
    role: row.role as DeviceRole,
    addedAt: row.added_at,
    // right(null, 4) is null in SQL; the generated type is not nullable.
    clerkTail: row.clerk_tail ?? null,
    telegramTail: row.telegram_tail ?? null,
  }))
}

/**
 * A user's role on a device, or null if not a member. Meant for the server
 * path: the service-role client bypasses RLS, so actions call this as their
 * explicit membership check.
 */
export const fetchMemberRole = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; userId: string },
): Promise<DeviceRole | null> => {
  const { data, error } = await supabase
    .from('device_users')
    .select('role')
    .eq('device_id', params.deviceId)
    .eq('user_id', params.userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch member role: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data?.role as DeviceRole | undefined) ?? null
}

export interface DeviceMemberIdentity {
  userId: string
  clerkUserId: string | null
}

/**
 * Members of a device with their full Clerk ids. Server path only — the
 * service-role client bypasses RLS and `users` is own-row-only for clients.
 * Used to resolve display names from Clerk without ever storing them.
 */
export const fetchDeviceMemberIdentities = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<DeviceMemberIdentity[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select('userId:user_id, user:users ( clerkUserId:clerk_user_id )')
    .eq('device_id', params.deviceId)

  if (error) {
    throw new ServiceError(
      `Failed to fetch device member identities: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    userId: row.userId,
    clerkUserId: row.user?.clerkUserId ?? null,
  }))
}
