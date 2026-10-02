import 'server-only'

import { apiJson, preflight } from '@/lib/api/respond'
import { requireStation } from '@/lib/api/station-gate'
import { toApiReading } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { fetchLatestReading } from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (_req, ctx, { stationId }) => {
    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response
    const reading = await fetchLatestReading(ctx.service, {
      deviceId: stationId,
    })
    return apiJson({ data: reading ? toApiReading(reading) : null }, ctx.meta)
  },
)

export const OPTIONS = preflight
