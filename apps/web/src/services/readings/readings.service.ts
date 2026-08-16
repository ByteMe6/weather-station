import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reading, ReadingPayload } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

import type { BucketedRow, HistoryPoint, HistoryRange } from '@/lib/chart'
import {
  bucketMinutesFor,
  bucketedToPoints,
  rangeWindow,
  toHistoryPoints,
} from '@/lib/chart'

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

type BucketedSqlRow =
  Database['public']['Functions']['readings_bucketed']['Returns'][number]

const toBucketedRow = (r: BucketedSqlRow): BucketedRow => ({
  bucket: r.bucket,
  avgTemperature: r.avg_temperature,
  minTemperature: r.min_temperature,
  maxTemperature: r.max_temperature,
  avgHumidity: r.avg_humidity,
  minHumidity: r.min_humidity,
  maxHumidity: r.max_humidity,
  avgPressure: r.avg_pressure,
  minPressure: r.min_pressure,
  maxPressure: r.max_pressure,
  avgWindSpeed: r.avg_wind_speed,
  maxWindSpeed: r.max_wind_speed,
  totalPrecipitation: r.total_precipitation,
  sampleCount: r.sample_count,
})

/**
 * Bucketed aggregates via readings_bucketed() (MRP-34). rpc() cannot alias
 * columns, so this is the one place RPC rows are mapped by hand.
 */
export const fetchReadingsBucketed = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; from: string; to: string; bucketMinutes: number },
): Promise<BucketedRow[]> => {
  const { data, error } = await supabase.rpc('readings_bucketed', {
    p_device_id: params.deviceId,
    p_from: params.from,
    p_to: params.to,
    p_bucket_minutes: params.bucketMinutes,
  })
  if (error) {
    throw new ServiceError(
      `Failed to fetch bucketed readings: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map(toBucketedRow)
}

/** History points for any chart range: 24h raw rows, 7d/30d bucketed averages with min/max bands. */
export const fetchReadingsHistory = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; range: HistoryRange },
): Promise<HistoryPoint[]> => {
  const window = rangeWindow(params.range)
  const bucketMinutes = bucketMinutesFor(params.range)
  if (bucketMinutes === null) {
    return toHistoryPoints(
      await fetchReadingsRange(supabase, {
        deviceId: params.deviceId,
        ...window,
      }),
    )
  }
  return bucketedToPoints(
    await fetchReadingsBucketed(supabase, {
      deviceId: params.deviceId,
      ...window,
      bucketMinutes,
    }),
  )
}

export interface ReadingsCursor {
  timestamp: string
  id: number
}

/**
 * One keyset page of raw readings for export (MRP-35): rows after `cursor` in
 * (timestamp, id) order, capped at `limit`. Callers keep `limit` at or below
 * PostgREST's max_rows (1000) or pages are silently truncated. The cursor's
 * timestamp is interpolated into a PostgREST filter, so callers validate it
 * as an ISO datetime first (the export action does via zod).
 */
export const fetchReadingsPage = async (
  supabase: SupabaseClient<Database>,
  params: {
    deviceId: string
    from: string
    to: string
    cursor: ReadingsCursor | null
    limit: number
  },
): Promise<Reading[]> => {
  let query = supabase
    .from('readings')
    .select(READING_COLUMNS)
    .eq('device_id', params.deviceId)
    .gte('timestamp', params.from)
    .lte('timestamp', params.to)
    .order('timestamp', { ascending: true })
    .order('id', { ascending: true })
    .limit(params.limit)
  if (params.cursor) {
    const { timestamp, id } = params.cursor
    query = query.or(
      `timestamp.gt.${timestamp},and(timestamp.eq.${timestamp},id.gt.${id})`,
    )
  }
  const { data, error } = await query
  if (error) {
    throw new ServiceError(
      `Failed to fetch readings page: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []) as Reading[]
}
