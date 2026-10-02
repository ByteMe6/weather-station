import 'server-only'

import { apiJson, preflight } from '@/lib/api/respond'
import { listStations } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Every station the key's owner is a member of — owned and shared. */
export const GET = withApiKey(
  { scope: 'read', cors: true },
  async (_req, ctx) =>
    apiJson({ data: await listStations(ctx.service, ctx.userId) }, ctx.meta),
)

export const OPTIONS = preflight
