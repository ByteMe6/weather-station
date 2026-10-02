import 'server-only'

import { canEditDeviceProfile } from '@ws/shared'

import { apiError, apiJson, preflight } from '@/lib/api/respond'
import { fieldErrorsFrom, stationPatchSchema } from '@/lib/api/schemas'
import { requireStation } from '@/lib/api/station-gate'
import { lastReadingAt, toApiStation, withProfile } from '@/lib/api/stations'
import { withApiKey } from '@/lib/api/with-api-key'
import { ServiceError } from '@/services/database/types'
import type { DeviceProfile } from '@/services/devices/devices.service'
import {
  DEVICE_PROFILE_FORBIDDEN,
  writeDeviceProfile,
} from '@/services/devices/devices.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { stationId: string }

// A valid patch is well under 1 KiB; 4 KiB leaves slack and bounds the parse.
const MAX_BODY_CHARS = 4096

const FORBIDDEN_EDIT = 'Only owners and editors can edit this station'

export const GET = withApiKey<Params>(
  { scope: 'read', cors: true },
  async (_req, ctx, { stationId }) => {
    const gate = await requireStation(ctx, stationId)
    if (!gate.ok) return gate.response
    return apiJson(
      {
        data: toApiStation(
          gate.station,
          await lastReadingAt(ctx.service, stationId),
        ),
      },
      ctx.meta,
    )
  },
)

/**
 * Station details for owners and editors (canEditDeviceProfile). Omitted keeps,
 * null clears — merged here because update_device_profile() replaces all four
 * columns. No CORS: a write key must not live in browser JavaScript.
 */
export const PATCH = withApiKey<Params>(
  { scope: 'read_write', cors: false },
  async (req, ctx, { stationId }) => {
    // Read-merge-write race, accepted per spec: update_device_profile()
    // replaces all four columns, so two concurrent PATCHes touching different
    // fields can lose one of the updates.
    const text = await req.text()
    if (text.length > MAX_BODY_CHARS) {
      return apiError('INVALID_INPUT', ctx.meta, {
        message: 'Body too large',
      })
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return apiError('INVALID_INPUT', ctx.meta, {
        message: 'Send a JSON object',
      })
    }
    const parsed = stationPatchSchema.safeParse(body)
    if (!parsed.success) {
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: fieldErrorsFrom(parsed.error),
      })
    }

    const gate = await requireStation(
      ctx,
      stationId,
      canEditDeviceProfile,
      FORBIDDEN_EDIT,
    )
    if (!gate.ok) return gate.response

    const current = gate.station.device
    const patch = parsed.data
    const merged: DeviceProfile = {
      label: patch.label !== undefined ? patch.label : current.label,
      address: patch.address !== undefined ? patch.address : current.address,
      latitude:
        patch.latitude !== undefined ? patch.latitude : current.latitude,
      longitude:
        patch.longitude !== undefined ? patch.longitude : current.longitude,
    }
    // Mirrors devices_coords_both_or_neither, as a field error instead of a 23514.
    if ((merged.latitude === null) !== (merged.longitude === null)) {
      const missing = merged.latitude === null ? 'latitude' : 'longitude'
      return apiError('INVALID_INPUT', ctx.meta, {
        fieldErrors: {
          [missing]: 'Send latitude and longitude together, or null both',
        },
      })
    }

    let stored: DeviceProfile | null
    try {
      stored = await writeDeviceProfile(ctx.service, {
        deviceId: stationId,
        userId: ctx.userId,
        profile: merged,
      })
    } catch (err) {
      if (
        err instanceof ServiceError &&
        err.message === DEVICE_PROFILE_FORBIDDEN
      ) {
        // The TypeScript gate and the SQL check reached opposite conclusions —
        // the anomaly update_device_profile() exists to catch.
        console.error('[api] PATCH station: gate and RPC disagree', {
          stationId,
          userId: ctx.userId,
          role: gate.station.role,
        })
        return apiError('FORBIDDEN', ctx.meta, { message: FORBIDDEN_EDIT })
      }
      throw err
    }
    if (!stored) return apiError('NOT_FOUND', ctx.meta)

    return apiJson(
      {
        data: toApiStation(
          withProfile(gate.station, stored),
          await lastReadingAt(ctx.service, stationId),
        ),
      },
      ctx.meta,
    )
  },
)

export const OPTIONS = preflight
