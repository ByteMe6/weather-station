import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reading, ReadingPayload } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

import type { HistoryRange } from '@/lib/chart'
import { rangeWindow } from '@/lib/chart'

/** Aliased read columns — never select('*') on the big table (CLAUDE.md). */
const READING_COLUMNS =
  'id, deviceId:device_id, timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation'

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

/** Most recent reading for a device, or null when it has never posted (MRP-25). */
export const fetchLatestReading = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string },
): Promise<Reading | null> => {
  const { data, error } = await supabase
    .from('readings')
    .select(READING_COLUMNS)
    .eq('device_id', params.deviceId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch latest reading: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data
}

/** Raw readings in [from, to] for one device, ascending. Uses the (device_id, timestamp DESC) index. */
export const fetchReadingsRange = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; from: string; to: string },
): Promise<Reading[]> => {
  const { data, error } = await supabase
    .from('readings')
    .select(READING_COLUMNS)
    .eq('device_id', params.deviceId)
    .gte('timestamp', params.from)
    .lte('timestamp', params.to)
    .order('timestamp', { ascending: true })
    .limit(2000)

  if (error) {
    throw new ServiceError(
      `Failed to fetch readings range: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data ?? []
}

/** History for a chart range. 24h = raw rows; 7d/30d switch to the bucketed RPC in Plan 2 (MRP-34). */
export const fetchReadingsHistory = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; range: HistoryRange },
): Promise<Reading[]> => {
  if (params.range !== '24h') {
    throw new ServiceError(
      `Range ${params.range} is not available yet`,
      'RANGE_NOT_SUPPORTED',
    )
  }
  return fetchReadingsRange(supabase, {
    deviceId: params.deviceId,
    ...rangeWindow(params.range),
  })
}
