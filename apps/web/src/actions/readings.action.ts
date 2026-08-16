'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId, resolveMemberRole } from './_helpers'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { CSV_HEADER, readingToCsvLine } from '@/lib/csv'
import type { ReadingsCursor } from '@/services/readings/readings.service'
import { fetchReadingsPage } from '@/services/readings/readings.service'

export type ExportCursor = ReadingsCursor
// Must not exceed PostgREST's max_rows (1000 by default) or chunks are silently truncated.
const CHUNK = 1_000
const MAX_DAYS = 366

const inputSchema = z
  .object({
    deviceId: z.string().min(1),
    from: z.string().datetime(),
    to: z.string().datetime(),
    // The cursor is interpolated into a PostgREST filter expression, so it is
    // pinned to an ISO datetime (PostgREST returns '+00:00' offsets) and a
    // non-negative integer — nothing else can reach the query DSL.
    cursor: z
      .object({
        timestamp: z.string().datetime({ offset: true }),
        id: z.number().int().nonnegative(),
      })
      .nullable(),
  })
  .refine(
    (v) => new Date(v.to).getTime() > new Date(v.from).getTime(),
    'to must be after from',
  )
  .refine(
    (v) =>
      new Date(v.to).getTime() - new Date(v.from).getTime() <=
      MAX_DAYS * 86_400_000,
    'range too long',
  )

/**
 * CSV export (PRD W5, MRP-35) — chunked so no single response is large.
 * Keyset pagination on (timestamp, id); the client concatenates chunks.
 * Service role + explicit device_users check (RLS is bypassed here).
 */
export const exportReadingsChunkAction = async (input: {
  deviceId: string
  from: string
  to: string
  cursor: ExportCursor | null
}): Promise<
  ActionResult<{
    lines: string[]
    nextCursor: ExportCursor | null
    includesHeader: boolean
  }>
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success)
    return actionError('INVALID_INPUT', 'Pick a range of at most one year')
  const { deviceId, from, to, cursor } = parsed.data

  const service = createServiceRoleClient()
  try {
    const userId = await resolveCurrentUserId(service, clerkUserId)
    const role = userId
      ? await resolveMemberRole(service, userId, deviceId)
      : null
    if (!role)
      return actionError('FORBIDDEN', "You don't have access to this station")

    const rows = await fetchReadingsPage(service, {
      deviceId,
      from,
      to,
      cursor,
      limit: CHUNK,
    })
    const lines = rows.map(readingToCsvLine)
    const includesHeader = cursor === null
    if (includesHeader) lines.unshift(CSV_HEADER)
    const last = rows[rows.length - 1]
    const nextCursor =
      rows.length >= CHUNK && last
        ? { timestamp: last.timestamp, id: last.id }
        : null
    return actionOk({ lines, nextCursor, includesHeader })
  } catch (err) {
    console.error('exportReadingsChunkAction failed', err)
    return actionError('UNKNOWN', 'Export failed. Try again.')
  }
}
