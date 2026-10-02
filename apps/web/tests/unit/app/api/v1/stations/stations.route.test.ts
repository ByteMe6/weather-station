import { apiRequest, params, RESET, stationRow } from './fixtures'

import * as stationRoute from '@/app/api/v1/stations/[stationId]/route'
import * as stationsRoute from '@/app/api/v1/stations/route'
import type { ApiKeyPrincipal } from '@/lib/api/keys/provider'
import { ServiceError } from '@/services/database/types'
import type * as DevicesService from '@/services/devices/devices.service'
import type {
  DeviceProfile,
  MyDevice,
} from '@/services/devices/devices.service'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
const authenticate = jest.fn<Promise<ApiKeyPrincipal | null>, [string]>()
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({ authenticate: (t: string) => authenticate(t) }),
}))
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: async () => ({ allowed: true, remaining: 59, resetAt: RESET }),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))
const fetchStations = jest.fn<Promise<MyDevice[]>, [unknown, unknown]>()
const fetchStation = jest.fn<Promise<MyDevice | null>, [unknown, unknown]>()
const writeProfile = jest.fn<
  Promise<DeviceProfile | null>,
  [unknown, unknown]
>()
jest.mock('@/services/devices/devices.service', () => ({
  ...jest.requireActual<typeof DevicesService>(
    '@/services/devices/devices.service',
  ),
  fetchStationsForUser: (s: unknown, p: unknown) => fetchStations(s, p),
  fetchStationForUser: (s: unknown, p: unknown) => fetchStation(s, p),
  writeDeviceProfile: (s: unknown, p: unknown) => writeProfile(s, p),
}))
const fetchLatest = jest.fn<
  Promise<{ timestamp: string }>,
  [unknown, unknown]
>()
jest.mock('@/services/readings/readings.service', () => ({
  fetchLatestReading: (s: unknown, p: unknown) => fetchLatest(s, p),
}))

const asKey = (scope: ApiKeyPrincipal['scope']) =>
  authenticate.mockResolvedValue({ keyId: 'k1', userId: 'u1', scope })

const patch = (body: unknown) =>
  stationRoute.PATCH(
    apiRequest('/stations/ws-abc123', { method: 'PATCH', body }),
    params({ stationId: 'ws-abc123' }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  asKey('read_write')
  fetchLatest.mockResolvedValue({ timestamp: '2026-10-01T08:55:00+00:00' })
  fetchStation.mockResolvedValue(stationRow('owner'))
  writeProfile.mockImplementation(
    async (_s, p) => (p as { profile: DeviceProfile }).profile,
  )
})

describe('GET /stations', () => {
  it('lists the key owner’s stations with their last reading', async () => {
    fetchStations.mockResolvedValue([
      stationRow('owner'),
      { ...stationRow('viewer'), deviceId: 'ws-shared', device: null },
    ])
    const res = await stationsRoute.GET(apiRequest('/stations'), params({}))
    expect(res.status).toBe(200)
    expect(fetchStations).toHaveBeenCalledWith(
      { __brand: 'service' },
      { userId: 'u1' },
    )
    const body = (await res.json()) as { data: unknown[] }
    expect(body.data).toEqual([
      expect.objectContaining({
        id: 'ws-abc123',
        name: 'Balcony',
        role: 'owner',
        lastReadingAt: '2026-10-01T08:55:00+00:00',
      }),
    ])
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('GET /stations/{id}', () => {
  it('returns the station to a member', async () => {
    asKey('read')
    const res = await stationRoute.GET(
      apiRequest('/stations/ws-abc123'),
      params({ stationId: 'ws-abc123' }),
    )
    expect(res.status).toBe(200)
    expect(fetchLatest).toHaveBeenCalledWith(
      { __brand: 'service' },
      { deviceId: 'ws-abc123' },
    )
    expect(await res.json()).toMatchObject({
      data: {
        id: 'ws-abc123',
        location: { latitude: 50.45, longitude: 30.52 },
      },
    })
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    const res = await stationRoute.GET(
      apiRequest('/stations/ws-other'),
      params({ stationId: 'ws-other' }),
    )
    expect(res.status).toBe(404)
  })

  it('answers 404 to a malformed id without querying', async () => {
    const res = await stationRoute.GET(
      apiRequest('/stations/x'),
      params({ stationId: 'a'.repeat(65) }),
    )
    expect(res.status).toBe(404)
    expect(fetchStation).not.toHaveBeenCalled()
  })
})

describe('PATCH /stations/{id}', () => {
  it('refuses a read-only key before reading the body', async () => {
    asKey('read')
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: { code: 'INSUFFICIENT_SCOPE' },
    })
    expect(fetchStation).not.toHaveBeenCalled()
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it('refuses a viewer with FORBIDDEN', async () => {
    fetchStation.mockResolvedValue(stationRow('viewer'))
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    expect(writeProfile).not.toHaveBeenCalled()
  })

  // Narrowing canEditDeviceProfile to owners must fail here (CLAUDE.md,
  // "Mutating either predicate must fail tests on both sides").
  it('lets an editor write', async () => {
    fetchStation.mockResolvedValue(stationRow('editor'))
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(200)
    expect(fetchLatest).toHaveBeenCalledWith(
      { __brand: 'service' },
      { deviceId: 'ws-abc123' },
    )
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await patch({ label: 'Roof' })).status).toBe(404)
  })

  it('keeps omitted fields and clears nulls', async () => {
    await patch({ address: null })
    expect(writeProfile).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        userId: 'u1',
        profile: {
          label: 'Balcony',
          address: null,
          latitude: 50.45,
          longitude: 30.52,
        },
      },
    )
  })

  it.each([
    ['latitude null', { latitude: null }, 'latitude'],
    ['longitude null', { latitude: 1, longitude: null }, 'longitude'],
  ])('rejects half a coordinate pair (%s)', async (_label, body, key) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: { fieldErrors: Record<string, string> }
    }
    expect(Object.keys(json.error.fieldErrors)).toEqual([key])
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it('accepts both coordinates on a station that has none', async () => {
    fetchStation.mockResolvedValue(
      stationRow('owner', { latitude: null, longitude: null }),
    )
    const res = await patch({ latitude: 1, longitude: 2 })
    expect(res.status).toBe(200)
    expect(writeProfile).toHaveBeenCalledWith(
      { __brand: 'service' },
      expect.objectContaining({
        profile: expect.objectContaining({
          latitude: 1,
          longitude: 2,
        }) as unknown,
      }),
    )
  })

  it.each([
    ['empty body', '{}', 'body'],
    ['unknown key', '{"name":"x"}', 'name'],
    ['non-JSON', '{nope', undefined],
    ['oversize', JSON.stringify({ label: 'x'.repeat(5000) }), undefined],
  ])('rejects %s before any lookup', async (label, rawBody, key) => {
    const res = await stationRoute.PATCH(
      apiRequest('/stations/ws-abc123', { method: 'PATCH', rawBody }),
      params({ stationId: 'ws-abc123' }),
    )
    expect(res.status).toBe(400)
    const json = (await res.json()) as {
      error: { message: string; fieldErrors?: Record<string, string> }
    }
    // An unknown key also leaves the patch without a recognised field, so
    // `body` can accompany it; the named key must be present.
    if (key) expect(Object.keys(json.error.fieldErrors ?? {})).toContain(key)
    if (label === 'oversize') expect(json.error.message).toBe('Body too large')
    expect(fetchStation).not.toHaveBeenCalled()
    expect(writeProfile).not.toHaveBeenCalled()
  })

  it('answers 404 when the write matches no row', async () => {
    writeProfile.mockResolvedValue(null)
    expect((await patch({ label: 'Roof' })).status).toBe(404)
  })

  it('returns the row the database stored, not the input', async () => {
    writeProfile.mockResolvedValue({
      label: 'Stored',
      address: 'Main St 1',
      latitude: 50.45,
      longitude: 30.52,
    })
    const res = await patch({ label: 'Roof' })
    expect(await res.json()).toMatchObject({
      data: { label: 'Stored', name: 'Stored' },
    })
  })

  it('logs and answers 403 when the SQL check disagrees with the gate', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    writeProfile.mockRejectedValue(
      new ServiceError('DEVICE_PROFILE_FORBIDDEN', 'P0001'),
    )
    const res = await patch({ label: 'Roof' })
    expect(res.status).toBe(403)
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('gate and RPC disagree'),
      expect.objectContaining({ role: 'owner' }),
    )
    log.mockRestore()
  })

  it('carries no CORS headers, so browsers cannot send it', async () => {
    const res = await patch({ label: 'Roof' })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('OPTIONS', () => {
  it('allows GET only', () => {
    const res = stationRoute.OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, OPTIONS')
  })
})
