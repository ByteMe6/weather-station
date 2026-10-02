import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiReading, ApiStation, Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import type {
  DeviceProfile,
  StationRow,
} from '@/services/devices/devices.service'
import {
  deviceDisplayName,
  fetchStationsForUser,
} from '@/services/devices/devices.service'
import { fetchLatestReading } from '@/services/readings/readings.service'

/**
 * Response shaping for the public API. This is not row aliasing (the queries
 * alias in .select()); it builds the documented contract — a nested location,
 * a display name — from rows that are already camelCase.
 */
export const toApiStation = (
  row: StationRow,
  lastReadingAt: string | null,
): ApiStation => ({
  id: row.deviceId,
  name: deviceDisplayName(row),
  label: row.device.label,
  address: row.device.address,
  location:
    row.device.latitude !== null && row.device.longitude !== null
      ? { latitude: row.device.latitude, longitude: row.device.longitude }
      : null,
  role: row.role,
  status: row.device.status,
  addedAt: row.addedAt,
  createdAt: row.device.createdAt,
  lastReadingAt,
})

export const withProfile = (
  row: StationRow,
  profile: DeviceProfile,
): StationRow => ({ ...row, device: { ...row.device, ...profile } })

/** Drops `id` / `deviceId`, which are internal to the readings table. */
export const toApiReading = (r: Reading): ApiReading => ({
  timestamp: r.timestamp,
  temperature: r.temperature,
  humidity: r.humidity,
  pressure: r.pressure,
  windSpeed: r.windSpeed,
  windDirection: r.windDirection,
  precipitation: r.precipitation,
})

export const lastReadingAt = async (
  service: SupabaseClient<Database>,
  deviceId: string,
): Promise<string | null> =>
  (await fetchLatestReading(service, { deviceId }))?.timestamp ?? null

/** Every station the user is a member of, with its last reading time. */
export const listStations = async (
  service: SupabaseClient<Database>,
  userId: string,
): Promise<ApiStation[]> => {
  const rows = await fetchStationsForUser(service, { userId })
  // device is null only if the embedded join came back empty; device_users
  // cascades on device delete, so such a row is skipped rather than reported.
  const stations = rows.flatMap((row) =>
    row.device ? [{ ...row, device: row.device }] : [],
  )
  return Promise.all(
    stations.map(async (row) =>
      toApiStation(row, await lastReadingAt(service, row.deviceId)),
    ),
  )
}
