import {
  API_AGGREGATE_DEFAULT_INTERVAL,
  API_AGGREGATE_INTERVALS,
  API_READINGS_PAGE_DEFAULT,
  API_READINGS_PAGE_MAX,
} from '@ws/shared'
import type { ZodError } from 'zod'
import { z } from 'zod'

const DAY_MS = 86_400_000

const DATETIME_MESSAGE =
  'Use an ISO 8601 datetime with a timezone, from 1970 on, e.g. 2026-10-01T00:00:00Z'

/**
 * Zod 3 accepts shapes Postgres rejects (offset +99:99 parses to NaN, year
 * 0000). Left alone those would reach the database and surface as a 500, so
 * require a finite epoch >= 0 here.
 */
export const isParseableTimestamp = (s: string): boolean => {
  const t = Date.parse(s)
  return Number.isFinite(t) && t >= 0
}

const isoDatetime = z
  .string()
  .datetime({ offset: true, message: DATETIME_MESSAGE })
  .refine(isParseableTimestamp, { message: DATETIME_MESSAGE })

/** GET /stations/{id}/readings. `.strict()` so a typo like `form=` is a 400, not a silent default. */
export const readingsQuerySchema = z
  .object({
    from: isoDatetime.optional(),
    to: isoDatetime.optional(),
    // Digits only: z.coerce.number() alone would take '0x10' and '1e2'.
    limit: z
      .string()
      .regex(/^\d+$/, 'limit must be a whole number')
      .pipe(z.coerce.number().int().min(1).max(API_READINGS_PAGE_MAX))
      .default(String(API_READINGS_PAGE_DEFAULT)),
    cursor: z.string().max(512).optional(),
  })
  .strict()

/** GET /stations/{id}/readings/aggregate. */
export const aggregateQuerySchema = z
  .object({
    from: isoDatetime.optional(),
    to: isoDatetime.optional(),
    interval: z
      .enum(API_AGGREGATE_INTERVALS)
      .default(API_AGGREGATE_DEFAULT_INTERVAL),
  })
  .strict()

const clearableText = (max: number, field: string) =>
  z
    .string()
    .trim()
    .min(1, `Send null to clear the ${field}`)
    .max(max, `Keep the ${field} to at most ${max} characters`)
    .nullable()
    .optional()

/**
 * PATCH /stations/{id}: omitted = keep, null = clear. Same limits as the
 * Settings form and the devices check constraints (label 1–40, address 1–200).
 */
export const stationPatchSchema = z
  .object({
    label: clearableText(40, 'nickname'),
    address: clearableText(200, 'address'),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Send at least one of label, address, latitude, longitude',
  })

/** First message per field; unknown keys are named; a body-level issue is "body". */
export const fieldErrorsFrom = (error: ZodError): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const keys =
      issue.code === 'unrecognized_keys'
        ? issue.keys
        : [issue.path.length > 0 ? issue.path.join('.') : 'body']
    for (const key of keys) out[key] ??= issue.message
  }
  return out
}

export interface TimeWindow {
  from: string
  to: string
}

/**
 * `to` defaults to now, `from` to `to - defaultSpanMs`; from < to and the span
 * is capped. Returns ISO strings normalised to UTC.
 */
export const resolveWindow = (
  input: { from?: string; to?: string },
  defaultSpanMs: number,
  maxSpanMs: number,
  now: number = Date.now(),
):
  | { ok: true; window: TimeWindow }
  | { ok: false; fieldErrors: Record<string, string> } => {
  const toMs = input.to ? Date.parse(input.to) : now
  const fromMs = input.from ? Date.parse(input.from) : toMs - defaultSpanMs
  if (!Number.isFinite(toMs)) {
    return { ok: false, fieldErrors: { to: DATETIME_MESSAGE } }
  }
  if (!Number.isFinite(fromMs)) {
    return { ok: false, fieldErrors: { from: DATETIME_MESSAGE } }
  }
  if (fromMs >= toMs) {
    return {
      ok: false,
      fieldErrors: { from: '`from` must be earlier than `to`' },
    }
  }
  if (toMs - fromMs > maxSpanMs) {
    const days = Number((maxSpanMs / DAY_MS).toFixed(1))
    return {
      ok: false,
      fieldErrors: { from: `The window may span at most ${days} days` },
    }
  }
  return {
    ok: true,
    window: {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
  }
}
