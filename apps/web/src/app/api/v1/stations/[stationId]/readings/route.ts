import 'server-only'

import {
  API_READINGS_DEFAULT_SPAN_MS,
  API_READINGS_MAX_SPAN_MS,
} from '@ws/shared'

import { decodeCursor, encodeCursor } from '@/lib/api/cursor'
import { apiError, apiJson, preflight } from '@/lib/api/respond'
import {
  fieldErrorsFrom,
  readingsQuerySchema,
  resolveWindow,
} from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { toApiReading } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchReadingsPage } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

/**
 * Raw 5-minute readings, ascending, keyset-paginated. A full page carries
 * `nextCursor`; callers pass it back with the same from/to.
 */
export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (req, ctx, { stationId }) => {
    const parsed = readingsQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }
    const query = parsed.data
    const cursor =
      query.cursor === undefined ? null : decodeCursor(query.cursor)
    if (query.cursor !== undefined && !cursor) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: { cursor: 'Pass back the nextCursor value unchanged' },
      })
    }
    const window = resolveWindow(
      query,
      API_READINGS_DEFAULT_SPAN_MS,
      API_READINGS_MAX_SPAN_MS,
    )
    if (!window.ok) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: window.fieldErrors,
      })
    }

    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response

    const rows = await fetchReadingsPage(ctx.service, {
      deviceId: stationId,
      from: window.window.from,
      to: window.window.to,
      cursor,
      limit: query.limit,
    })
    const last = rows.at(-1)
    const nextCursor =
      rows.length === query.limit && last
        ? encodeCursor({ timestamp: last.timestamp, id: last.id })
        : null
    return apiJson({ data: rows.map(toApiReading), nextCursor }, ctx.meta)
  },
)

export const OPTIONS = preflight
