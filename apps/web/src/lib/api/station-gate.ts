import 'server-only'

import type { DeviceRole } from '@ws/shared'

import { apiError } from './respond'
import type { ApiContext } from './with-api-key'

import type { StationRow } from '@/services/devices/devices.service'
import { fetchStationForUser } from '@/services/devices/devices.service'

const STATION_ID = /^[A-Za-z0-9_-]{1,64}$/

const anyMember = (): boolean => true

/**
 * The membership gate for every /stations/{id} route — RLS is bypassed on this
 * path, so this is the check. One query returns both the role and the station.
 * Not a member, unknown and malformed ids all answer the same 404. `allows` is
 * a predicate from @ws/shared (canEditDeviceProfile…) — never re-spelled here.
 */
export const requireStation = async (
  ctx: ApiContext,
  stationId: string,
  allows: (role: DeviceRole) => boolean = anyMember,
  forbiddenMessage?: string,
): Promise<
  { ok: true; station: StationRow } | { ok: false; response: Response }
> => {
  if (!STATION_ID.test(stationId)) {
    return { ok: false, response: apiError('NOT_FOUND', ctx.meta) }
  }
  const row = await fetchStationForUser(ctx.service, {
    userId: ctx.userId,
    deviceId: stationId,
  })
  if (!row?.device) {
    return { ok: false, response: apiError('NOT_FOUND', ctx.meta) }
  }
  if (!allows(row.role)) {
    return {
      ok: false,
      response: apiError(
        'FORBIDDEN',
        ctx.meta,
        forbiddenMessage ? { message: forbiddenMessage } : {},
      ),
    }
  }
  return { ok: true, station: { ...row, device: row.device } }
}
