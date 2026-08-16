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

export interface HistoryPoint {
  t: number
  temperature: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  precipitation: number | null
}

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
