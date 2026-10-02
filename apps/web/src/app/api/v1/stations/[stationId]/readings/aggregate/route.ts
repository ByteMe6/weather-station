import 'server-only'

import {
  API_AGGREGATE_DEFAULT_SPAN_MS,
  API_AGGREGATE_INTERVAL_MINUTES,
  aggregateMaxSpanMs,
} from '@ws/shared'

import { apiError, apiJson, preflight } from '@/lib/api/respond'
import {
  aggregateQuerySchema,
  fieldErrorsFrom,
  resolveWindow,
} from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchReadingsBucketed } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

/** min/avg/max per bucket via readings_bucketed(); at most 1000 buckets per request. */
export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (req, ctx, { stationId }) => {
    const parsed = aggregateQuerySchema.safeParse(
      Object.fromEntries(new URL(req.url).searchParams),
    )
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }
    const { interval } = parsed.data
    const window = resolveWindow(
      parsed.data,
      API_AGGREGATE_DEFAULT_SPAN_MS,
      aggregateMaxSpanMs(interval),
    )
    if (!window.ok) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: window.fieldErrors,
      })
    }

    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response

    const rows = await fetchReadingsBucketed(ctx.service, {
      deviceId: stationId,
      from: window.window.from,
      to: window.window.to,
      bucketMinutes: API_AGGREGATE_INTERVAL_MINUTES[interval],
    })
    return apiJson({ data: rows, interval }, ctx.meta)
  },
)

export const OPTIONS = preflight
