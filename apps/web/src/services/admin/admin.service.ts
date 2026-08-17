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

/**
 * Every device in the fleet, through a SECURITY DEFINER RPC that checks
 * is_admin_request() itself and returns an empty set to everyone else.
 *
 * Deliberately not a plain `select … from devices`: the permissive admin
 * policies this replaced also widened `users`, `device_users` and `schedules`,
 * and three user-facing queries are unfiltered because they rely on RLS
 * meaning "own rows only" — an admin's own dashboard broke as a result. Same
 * reasoning as device_members(). `secret` is not in the RPC's return type and
 * is ungranted besides, so it cannot surface here.
 *
 * rpc() rows cannot be aliased in the query, so they are mapped by hand.
 */
export const fetchAllDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminDevice[]> => {
  const { data, error } = await supabase.rpc('admin_devices')

  if (error) {
    throw new ServiceError(
      `Failed to fetch devices: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    deviceId: row.device_id,
    status: row.status as DeviceStatus,
    label: row.label,
    createdAt: row.created_at,
    memberCount: Number(row.member_count),
  }))
}

/** Every app user with how many stations they can see. Same RPC gating. */
export const fetchAllUsers = async (
  supabase: SupabaseClient<Database>,
): Promise<AdminUser[]> => {
  const { data, error } = await supabase.rpc('admin_users')

  if (error) {
    throw new ServiceError(
      `Failed to fetch users: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    clerkUserId: row.clerk_user_id,
    telegramId: row.telegram_id,
    createdAt: row.created_at,
    deviceCount: Number(row.device_count),
  }))
}
