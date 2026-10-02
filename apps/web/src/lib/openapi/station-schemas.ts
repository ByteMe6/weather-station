import type { ApiErrorBody, ApiReading, ApiStation } from '@ws/shared'
import { z } from 'zod'

import type { BucketedRow } from '@/lib/chart'

/**
 * Documentation schemas for the station API. Each is annotated with the type
 * the route actually returns, so the docs cannot drift from the contract
 * without a type error.
 */
export const stationDocSchema: z.ZodType<ApiStation> = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  address: z.string().nullable(),
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .nullable(),
  role: z.enum(['owner', 'editor', 'viewer']),
  status: z.enum(['unregistered', 'registered']),
  addedAt: z.string(),
  createdAt: z.string(),
  lastReadingAt: z.string().nullable(),
})

export const readingDocSchema: z.ZodType<ApiReading> = z.object({
  timestamp: z.string(),
  temperature: z.number(),
  humidity: z.number().nullable(),
  pressure: z.number(),
  windSpeed: z.number().nullable(),
  windDirection: z.number().nullable(),
  precipitation: z.number().nullable(),
})

const n = z.number().nullable()

export const bucketDocSchema: z.ZodType<BucketedRow> = z.object({
  bucket: z.string(),
  avgTemperature: n,
  minTemperature: n,
  maxTemperature: n,
  avgHumidity: n,
  minHumidity: n,
  maxHumidity: n,
  avgPressure: n,
  minPressure: n,
  maxPressure: n,
  avgWindSpeed: n,
  maxWindSpeed: n,
  totalPrecipitation: n,
  sampleCount: z.number().int(),
})

export const apiErrorDocSchema: z.ZodType<ApiErrorBody> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string()).optional(),
  }),
})
