import { canEditDeviceProfile } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import { requireStation } from '@/lib/api/station-gate'
import type { ApiContext } from '@/lib/api/with-api-key'
import type { StationRow } from '@/services/devices/devices.service'
import { fetchStationForUser } from '@/services/devices/devices.service'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
jest.mock('@/services/devices/devices.service', () => ({
  ...jest.requireActual<object>('@/services/devices/devices.service'),
  fetchStationForUser: jest.fn(),
}))

const fetchStation = jest.mocked(fetchStationForUser)

const ctx: ApiContext = {
  service: createServiceRoleClient(),
  userId: 'u1',
  keyId: 'k1',
  scope: 'read',
  meta: { cors: false },
}

const row: StationRow = {
  deviceId: 'ws-abc123',
  role: 'viewer',
  addedAt: '2026-08-16T10:00:00.000Z',
  device: {
    status: 'registered',
    createdAt: '2026-07-10T09:00:00.000Z',
    label: null,
    address: null,
    latitude: null,
    longitude: null,
  },
}

beforeEach(() => jest.clearAllMocks())

describe('requireStation', () => {
  it('answers 404 for a malformed id without querying', async () => {
    const r = await requireStation(ctx, 'bad id;drop')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(404)
    expect(fetchStation).not.toHaveBeenCalled()
  })

  it('answers 404 for a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    const r = await requireStation(ctx, 'ws-abc123')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(404)
  })

  it('answers 404 when the embedded device is missing', async () => {
    fetchStation.mockResolvedValue({ ...row, device: null })
    const r = await requireStation(ctx, 'ws-abc123')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(404)
  })

  it('answers 403 with the given message when the predicate refuses', async () => {
    fetchStation.mockResolvedValue(row)
    const r = await requireStation(
      ctx,
      'ws-abc123',
      canEditDeviceProfile,
      'Viewers cannot edit',
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(403)
    expect(await r.response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Viewers cannot edit' },
    })
  })

  it('returns the station with a non-null device when allowed', async () => {
    fetchStation.mockResolvedValue(row)
    const r = await requireStation(ctx, 'ws-abc123')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.station.device.status).toBe('registered')
  })
})
