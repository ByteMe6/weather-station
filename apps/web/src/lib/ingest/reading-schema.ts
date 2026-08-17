import { SENSOR_BOUNDS } from '@ws/shared'
import type { ReadingPayload } from '@ws/shared'
import { z } from 'zod'

const bounded = (b: { min: number; max: number }) =>
  z.number().finite().min(b.min).max(b.max)

/**
 * A reading's own timestamp needs bounds as much as its values do. A device
 * with a dead RTC or a failed NTP sync posts a plausible-looking payload dated
 * years away; the future case is the damaging one, because `fetchLatestReading`
 * orders by timestamp and that row becomes "current conditions" forever, skews
 * the 24 h range, and outlives any retention sweep.
 *
 * Asymmetric on purpose: a small forward tolerance covers clock skew, while a
 * generous backward window keeps legitimate backfill working after a device
 * has been offline.
 */
export const READING_FUTURE_TOLERANCE_MS = 5 * 60_000
export const READING_MAX_AGE_MS = 90 * 24 * 3_600_000

const readingTimestamp = z
  .string()
  .datetime()
  .refine((iso) => {
    const t = new Date(iso).getTime()
    const now = Date.now()
    return (
      t <= now + READING_FUTURE_TOLERANCE_MS && t >= now - READING_MAX_AGE_MS
    )
  }, 'timestamp is too far from the current time')

/** Validation source of truth; also feeds the OpenAPI document (Task 7). */
export const readingSchema = z.object({
  timestamp: readingTimestamp,
  temperature: bounded(SENSOR_BOUNDS.temperature),
  humidity: bounded(SENSOR_BOUNDS.humidity).nullable(),
  pressure: bounded(SENSOR_BOUNDS.pressure),
  windSpeed: bounded(SENSOR_BOUNDS.windSpeed).nullable(),
  windDirection: bounded(SENSOR_BOUNDS.windDirection).nullable(),
  precipitation: bounded(SENSOR_BOUNDS.precipitation).nullable(),
})

export type ReadingParseResult =
  { ok: true; data: ReadingPayload } | { ok: false; issues: z.ZodIssue[] }

export const parseReadingPayload = (input: unknown): ReadingParseResult => {
  const result = readingSchema.safeParse(input)
  if (!result.success) return { ok: false, issues: result.error.issues }
  return { ok: true, data: result.data }
}
