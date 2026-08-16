import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceStatus } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface AdminDevice {
  deviceId: string
  status: DeviceStatus
  label: string | null
  createdAt: string
  memberCount: number
}

export interface AdminUser {
  id: string
  clerkUserId: string | null
  telegramId: number | null
  createdAt: string
  deviceCount: number
}

// PostgREST returns an embedded aggregate as `[{ count: n }]`; that shape is
// the one thing these two services map by hand.
const countOf = (rows: { count: number }[] | null | undefined): number =>
  rows?.[0]?.count ?? 0

/**
 * Every device in the fleet. Readable only because the caller's session is in
 * the admin organisation — the "admin org can view all devices" policy ORs
 * with the member policy, so a normal user running this sees only their own.
 * `secret` is absent by column grant and cannot be selected here.
 */
export const fetchAllDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminDevice[]> => {
  const { data, error } = await supabase
    .from('devices')
    .select(
      'deviceId:device_id, status, label, createdAt:created_at, members:device_users(count)',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch devices: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    deviceId: row.deviceId,
    status: row.status as DeviceStatus,
    label: row.label,
    createdAt: row.createdAt,
    memberCount: countOf(row.members),
  }))
}

/** Every app user with how many stations they can see. */
export const fetchAllUsers = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminUser[]> => {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at, devices:device_users(count)',
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new ServiceError(
      `Failed to fetch users: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    clerkUserId: row.clerkUserId,
    telegramId: row.telegramId,
    createdAt: row.createdAt,
    deviceCount: countOf(row.devices),
  }))
}
