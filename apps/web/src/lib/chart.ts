import type { Reading } from '@ws/shared'

import type { ParameterKey } from './parameters'

export type HistoryRange = '24h' | '7d' | '30d'

const HOUR = 3_600_000
export const RANGE_MS: Record<HistoryRange, number> = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
}

export const rangeWindow = (
  range: HistoryRange,
  now: Date = new Date(),
): { from: string; to: string } => ({
  from: new Date(now.getTime() - RANGE_MS[range]).toISOString(),
  to: now.toISOString(),
})

/** 24h → raw rows; 7d → hourly buckets (168 pts); 30d → 6-hour buckets (120 pts). */
export const bucketMinutesFor = (range: HistoryRange): number | null =>
  range === '24h' ? null : range === '7d' ? 60 : 360

export interface HistoryPoint {
  t: number
  temperature: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  precipitation: number | null
  /** Min/max bands — present only for bucketed ranges. */
  temperatureMin?: number | null
  temperatureMax?: number | null
  humidityMin?: number | null
  humidityMax?: number | null
  pressureMin?: number | null
  pressureMax?: number | null
  windSpeedMax?: number | null
}

/** One row of readings_bucketed(), camelCased. */
export interface BucketedRow {
  bucket: string
  avgTemperature: number | null
  minTemperature: number | null
  maxTemperature: number | null
  avgHumidity: number | null
  minHumidity: number | null
  maxHumidity: number | null
  avgPressure: number | null
  minPressure: number | null
  maxPressure: number | null
  avgWindSpeed: number | null
  maxWindSpeed: number | null
  totalPrecipitation: number | null
  sampleCount: number
}

export const bucketedToPoints = (rows: BucketedRow[]): HistoryPoint[] =>
  rows.map((r) => ({
    t: new Date(r.bucket).getTime(),
    temperature: r.avgTemperature,
    temperatureMin: r.minTemperature,
    temperatureMax: r.maxTemperature,
    humidity: r.avgHumidity,
    humidityMin: r.minHumidity,
    humidityMax: r.maxHumidity,
    pressure: r.avgPressure,
    pressureMin: r.minPressure,
    pressureMax: r.maxPressure,
    windSpeed: r.avgWindSpeed,
    windSpeedMax: r.maxWindSpeed,
    windDirection: null,
    precipitation: r.totalPrecipitation,
  }))

const nullPoint = (t: number): HistoryPoint => ({
  t,
  temperature: null,
  humidity: null,
  pressure: null,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})

export const toHistoryPoints = (readings: Reading[]): HistoryPoint[] =>
  readings.map((r) => ({
    t: new Date(r.timestamp).getTime(),
    temperature: r.temperature,
    humidity: r.humidity,
    pressure: r.pressure,
    windSpeed: r.windSpeed,
    windDirection: r.windDirection,
    precipitation: r.precipitation,
  }))

/** Insert an all-null point after any gap larger than maxGapMs so Recharts draws a gap, not a line. */
export const withGaps = (
  points: HistoryPoint[],
  maxGapMs: number,
): HistoryPoint[] => {
  const out: HistoryPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const prev = points[i - 1]
    if (prev && p.t - prev.t > maxGapMs) out.push(nullPoint(prev.t + 1))
    out.push(p)
  }
  return out
}

export const lastN = (
  points: HistoryPoint[],
  windowMs: number,
  now: Date = new Date(),
): HistoryPoint[] => {
  const cutoff = now.getTime() - windowMs
  return points.filter((p) => p.t >= cutoff)
}

export interface Trend {
  delta: number
  direction: 'up' | 'down' | 'flat'
}

/** Latest value vs the value closest to `windowMs` ago; null when there is no earlier point. */
export const trendFor = (
  points: HistoryPoint[],
  key: ParameterKey,
  windowMs: number,
  now: Date = new Date(),
  flatBelow = 0.05,
): Trend | null => {
  const valid = points.filter((p) => p[key] !== null)
  if (valid.length < 2) return null
  const latest = valid[valid.length - 1]!
  const target = now.getTime() - windowMs
  let ref = valid[0]!
  for (const p of valid) {
    if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p
  }
  if (ref === latest) return null
  const delta =
    Math.round(((latest[key] as number) - (ref[key] as number)) * 100) / 100
  const direction =
    Math.abs(delta) < flatBelow ? 'flat' : delta > 0 ? 'up' : 'down'
  return { delta, direction }
}
