import { z } from 'zod'

import { isParseableTimestamp } from './schemas'

import type { ReadingsCursor } from '@/services/readings/readings.service'

/**
 * Validated before use: fetchReadingsPage interpolates the timestamp into a
 * PostgREST filter, so a tampered cursor must never reach it.
 */
const cursorSchema = z
  .object({
    timestamp: z
      .string()
      .datetime({ offset: true })
      .refine(isParseableTimestamp, { message: 'Invalid timestamp' }),
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()

/** Opaque to clients: base64url JSON of the last row's (timestamp, id). */
export const encodeCursor = (cursor: ReadingsCursor): string =>
  Buffer.from(
    JSON.stringify({ timestamp: cursor.timestamp, id: cursor.id }),
  ).toString('base64url')

export const decodeCursor = (raw: string): ReadingsCursor | null => {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
