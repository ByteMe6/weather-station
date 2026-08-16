import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface MyDevice {
  deviceId: string
  role: DeviceRole
  addedAt: string
  device: { status: string; createdAt: string } | null
}

/** Devices the current user is linked to (RLS on device_users + devices). Oldest link first. */
export const fetchMyDevices = async (
  supabase: SupabaseClient<Database>,
): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(
      'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at )',
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
  deviceId: string
  userId: string
  role: DeviceRole
  addedAt: string
  user: { clerkUserId: string | null; telegramId: number | null } | null
}

/** Members of a device — owners see all rows (owner policy), viewers see only themselves. */
export const fetchDeviceMembers = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<DeviceMember[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select(
      'deviceId:device_id, userId:user_id, role, addedAt:added_at, user:users ( clerkUserId:clerk_user_id, telegramId:telegram_id )',
    )
    .eq('device_id', params.deviceId)
    .order('added_at', { ascending: true })

  if (error) {
    throw new ServiceError(
      `Failed to fetch device members: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []) as DeviceMember[]
}
