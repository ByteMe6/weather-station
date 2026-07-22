import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReadingPayload } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

/**
 * Read a device's HMAC secret. Service-role only — `devices.secret` is never
 * exposed to any user path. No `status` filter: a flashed device ingests
 * before a user claims it (`unregistered`), which is expected.
 */
export const fetchDeviceSecret = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('devices')
    .select('secret')
    .eq('device_id', params.deviceId)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch device secret: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data?.secret ?? null
}

/**
 * Insert a reading (insert-only path). Uses ON CONFLICT DO NOTHING on the
 * `(device_id, timestamp)` unique index so a firmware retry of an
 * already-ingested reading is a silent success, not a 409 that would burn the
 * device's attempts (see migration comment on `readings_device_id_timestamp_idx`).
 */
export const insertReading = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; payload: ReadingPayload },
): Promise<void> => {
  const { payload } = params
  const { error } = await supabase.from('readings').upsert(
    {
      device_id: params.deviceId,
      timestamp: payload.timestamp,
      temperature: payload.temperature,
      humidity: payload.humidity,
      pressure: payload.pressure,
      wind_speed: payload.windSpeed,
      wind_direction: payload.windDirection,
      precipitation: payload.precipitation,
    },
    { onConflict: 'device_id,timestamp', ignoreDuplicates: true },
  )

  if (error) {
    throw new ServiceError(
      `Failed to insert reading: ${error.message}`,
      error.code,
      error.details,
    )
  }
}
