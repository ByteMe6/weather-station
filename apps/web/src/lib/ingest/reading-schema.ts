import { SENSOR_BOUNDS } from '@ws/shared'
import type { ReadingPayload } from '@ws/shared'
import { z } from 'zod'

const bounded = (b: { min: number; max: number }) =>
  z.number().finite().min(b.min).max(b.max)

/** Validation source of truth; also feeds the OpenAPI document (Task 7). */
export const readingSchema = z.object({
  timestamp: z.string().datetime(),
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
