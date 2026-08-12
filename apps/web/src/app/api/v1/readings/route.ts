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
import { ServiceError } from '@/services/database/types'
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

// The 500 response stays deliberately bare — a device is write-only and gets
// nothing back but `internal_error`. The cause still has to land somewhere,
// though: without this the only trace of a broken ingest is a 500 count in the
// platform log, and diagnosing one means reproducing the query by hand against
// the database, which is not something you can do on a deployed environment.
//
// Only the 500 paths log. The 401 stays silent and undifferentiated on purpose
// — it is what stops the endpoint being used to enumerate valid device ids.
//
// The two sites are tagged separately because they fail for unrelated reasons:
// one means the device could not be looked up, the other that the reading
// could not be stored. Different subsystem, different response.
const logIngestFailure = (
  stage: 'device-lookup' | 'insert-reading',
  deviceId: string,
  error: unknown,
): void => {
  // ServiceError carries the Postgres code and details that actually identify
  // the fault (a 23502 says which column, a 42P01 which relation). Anything
  // else only has a message worth keeping.
  const cause =
    error instanceof ServiceError
      ? { message: error.message, code: error.code, details: error.details }
      : { message: error instanceof Error ? error.message : String(error) }

  console.error(`[ingest] ${stage} failed for ${deviceId}`, cause)
}

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
  } catch (error) {
    logIngestFailure('device-lookup', deviceId, error)
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
  } catch (error) {
    logIngestFailure('insert-reading', deviceId, error)
    return internalError()
  }

  return Response.json({ ok: true }, { status: 201 })
}
