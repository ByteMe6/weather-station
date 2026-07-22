import 'server-only'

import {
  DEVICE_ID_HEADER,
  REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import { parseReadingPayload } from '@/lib/ingest/reading-schema'
import { verifySignature } from '@/lib/ingest/verify-signature'
import {
  fetchDeviceSecret,
  insertReading,
} from '@/services/readings/readings.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Unknown device, bad signature, stale timestamp, and missing headers all
// return the same opaque 401 — never reveal which check failed, so the endpoint
// can't be used to enumerate valid device ids.
const unauthorized = (): Response =>
  Response.json({ error: 'unauthorized' }, { status: 401 })

const badPayload = (issues: unknown): Response =>
  Response.json({ error: 'invalid_payload', issues }, { status: 400 })

const internalError = (): Response =>
  Response.json({ error: 'internal_error' }, { status: 500 })

export const POST = async (request: Request): Promise<Response> => {
  const deviceId = request.headers.get(DEVICE_ID_HEADER)
  const timestamp = request.headers.get(TIMESTAMP_HEADER)
  const signature = request.headers.get(SIGNATURE_HEADER)
  if (!deviceId || !timestamp || !signature) return unauthorized()

  // Freshness first — reject stale/replayed sends before touching the DB.
  const tsMs = Number(timestamp)
  if (
    !Number.isFinite(tsMs) ||
    Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS
  ) {
    return unauthorized()
  }

  const rawBody = await request.text()

  let supabase: ReturnType<typeof createServiceRoleClient>
  let secret: string | null
  try {
    supabase = createServiceRoleClient()
    secret = await fetchDeviceSecret(supabase, { deviceId })
  } catch {
    return internalError()
  }
  if (!secret) return unauthorized()

  if (!verifySignature({ secret, timestamp, rawBody, signature })) {
    return unauthorized()
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return badPayload([{ message: 'Body is not valid JSON' }])
  }

  const parsed = parseReadingPayload(json)
  if (!parsed.ok) return badPayload(parsed.issues)

  try {
    await insertReading(supabase, { deviceId, payload: parsed.data })
  } catch {
    return internalError()
  }

  return Response.json({ ok: true }, { status: 201 })
}
