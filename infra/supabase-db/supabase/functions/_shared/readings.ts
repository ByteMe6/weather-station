// Linked devices + latest reading each. Membership is checked in code
// because the service-role client bypasses RLS (project rule).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LatestReading {
  timestamp: string
  temperature: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  precipitation: number | null
}

export interface DeviceReading {
  deviceId: string
  label: string | null
  reading: LatestReading | null
}

// The untyped Deno client cannot know `devices` is a to-one embed; PostgREST
// returns an object there, but be tolerant of the array shape too.
const embeddedLabel = (value: unknown): string | null => {
  const rec = Array.isArray(value) ? value[0] : value
  if (typeof rec !== 'object' || rec === null) return null
  const label = (rec as { label?: unknown }).label
  return typeof label === 'string' ? label : null
}

export const fetchDeviceReadings = async (
  db: SupabaseClient,
  userId: string,
): Promise<DeviceReading[]> => {
  const { data: memberships, error } = await db
    .from('device_users')
    .select('deviceId:device_id, devices ( label )')
    .eq('user_id', userId)
    .order('added_at', { ascending: true })
  if (error) throw new Error(`device lookup failed: ${error.message}`)

  return Promise.all(
    (memberships ?? []).map(async (m): Promise<DeviceReading> => {
      const deviceId = m.deviceId as string
      const label = embeddedLabel(m.devices)
      const { data: reading, error: readError } = await db
        .from('readings')
        .select(
          'timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation',
        )
        .eq('device_id', deviceId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (readError)
        throw new Error(`reading lookup failed: ${readError.message}`)
      return {
        deviceId,
        label,
        reading: (reading as LatestReading | null) ?? null,
      }
    }),
  )
}

export const inferTimezone = async (
  db: SupabaseClient,
  userId: string,
): Promise<string> => {
  const { data, error } = await db
    .from('schedules')
    .select('timezone')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`timezone lookup failed: ${error.message}`)
  return (data?.timezone as string | undefined) ?? 'UTC'
}
