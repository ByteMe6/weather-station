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
    latitude: number | null
    longitude: number | null
  } | null
}

/** Display name for a station: the owner's nickname, else the id. */
export const deviceDisplayName = (d: MyDevice): string =>
  d.device?.label ?? d.deviceId

/** device_users row + the station it points at, aliased (CLAUDE.md). */
const STATION_COLUMNS =
  'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at, label, address, latitude, longitude )'

/** Devices the current user is linked to (RLS on device_users + devices). Oldest link first. */
export const fetchMyDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(STATION_COLUMNS)
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
 * so rows are mapped by hand here, as CLAUDE.md (Column Aliasing) describes.
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

/** A membership row whose station is known to exist. */
export type StationRow = MyDevice & {
  device: NonNullable<MyDevice['device']>
}

/**
 * Stations one user is a member of, for the service-role path (public API).
 *
 * NOT interchangeable with fetchMyDevices: that one has no WHERE clause and is
 * correct only on an RLS client, where the policies narrow device_users to the
 * caller's rows. On the service-role client it would return every user's
 * stations. This filters by user_id explicitly, so it is safe on either.
 */
export const fetchStationsForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string },
): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(STATION_COLUMNS)
    .eq('user_id', params.userId)
    .order('added_at', { ascending: true })

  if (error) {
    throw new ServiceError(
      `Failed to fetch stations: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
  return (data ?? []) as MyDevice[]
}

/** One station for one user, or null when they are not a member. Service-role safe. */
export const fetchStationForUser = async (
  supabase: SupabaseClient<Database>,
  params: { userId: string; deviceId: string },
): Promise<MyDevice | null> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(STATION_COLUMNS)
    .eq('user_id', params.userId)
    .eq('device_id', params.deviceId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch station: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // The DB check constraint guarantees role ∈ DeviceRole (see init migration).
  return data as MyDevice | null
}

export interface DeviceProfile {
  label: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
}

/** Message of the ServiceError thrown when update_device_profile() refuses the role. */
export const DEVICE_PROFILE_FORBIDDEN = 'DEVICE_PROFILE_FORBIDDEN'

/**
 * Writes the station profile through update_device_profile(), which re-checks
 * the caller's role in SQL. The four values REPLACE the stored ones — callers
 * wanting patch semantics merge first. Returns the row the database holds, or
 * null if the RPC returned none. A refusal by the SQL role check throws
 * ServiceError(DEVICE_PROFILE_FORBIDDEN, 'P0001').
 *
 * updateDeviceProfileAction predates this and calls the RPC itself; the public
 * API's PATCH /stations/{id} is the second caller and goes through here.
 */
export const writeDeviceProfile = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; userId: string; profile: DeviceProfile },
): Promise<DeviceProfile | null> => {
  const { data, error } = await supabase.rpc('update_device_profile', {
    p_device_id: params.deviceId,
    p_user_id: params.userId,
    // `?? undefined`, not null: the generated Args type cannot express a
    // nullable argument; the SQL defaults are null, so omitting the key clears.
    p_label: params.profile.label ?? undefined,
    p_address: params.profile.address ?? undefined,
    p_latitude: params.profile.latitude ?? undefined,
    p_longitude: params.profile.longitude ?? undefined,
  })
  if (error) {
    if (error.code === 'P0001' && error.message === DEVICE_PROFILE_FORBIDDEN) {
      throw new ServiceError(DEVICE_PROFILE_FORBIDDEN, 'P0001')
    }
    throw new ServiceError(
      `Failed to write device profile: ${error.message}`,
      error.code,
      error.details,
    )
  }
  // rpc() rows cannot be aliased (CLAUDE.md). `?? null` is not redundant:
  // gen types cannot infer RETURNS TABLE nullability, so all four arrive typed
  // non-null while every one is nullable in the database.
  const row = data?.[0]
  if (!row) return null
  return {
    label: row.out_label ?? null,
    address: row.out_address ?? null,
    latitude: row.out_latitude ?? null,
    longitude: row.out_longitude ?? null,
  }
}
