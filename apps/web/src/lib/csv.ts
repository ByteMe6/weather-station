import type { Reading } from '@ws/shared'

export const CSV_HEADER =
  'timestamp_utc,device_id,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,wind_direction_deg,precipitation_mm'

const cell = (v: number | null): string => (v === null ? '' : String(v))

export const readingToCsvLine = (r: Reading): string =>
  [
    r.timestamp,
    r.deviceId,
    cell(r.temperature),
    cell(r.humidity),
    cell(r.pressure),
    cell(r.windSpeed),
    cell(r.windDirection),
    cell(r.precipitation),
  ].join(',')

export const exportFilename = (
  deviceId: string,
  from: string,
  to: string,
): string => `weather_${deviceId}_${from.slice(0, 10)}_${to.slice(0, 10)}.csv`
