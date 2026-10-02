import type { Reading } from '@ws/shared'

import { apiRequest, params, RESET, stationRow } from './fixtures'

import * as aggregateRoute from '@/app/api/v1/stations/[stationId]/readings/aggregate/route'
import * as latestRoute from '@/app/api/v1/stations/[stationId]/readings/latest/route'
import * as rawRoute from '@/app/api/v1/stations/[stationId]/readings/route'
import { encodeCursor } from '@/lib/api/cursor'
import type { BucketedRow } from '@/lib/chart'
import type * as DevicesService from '@/services/devices/devices.service'
import type { MyDevice } from '@/services/devices/devices.service'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'service' })),
}))
jest.mock('@/lib/api/keys', () => ({
  getApiKeyProvider: () => ({
    authenticate: async () => ({ keyId: 'k1', userId: 'u1', scope: 'read' }),
  }),
}))
jest.mock('@/services/api-keys/rate-limit.service', () => ({
  hitRateLimit: async () => ({ allowed: true, remaining: 59, resetAt: RESET }),
  apiKeyRateLimitBucket: (id: string) => `key:${id}`,
}))
const fetchStation = jest.fn<Promise<MyDevice | null>, [unknown, unknown]>()
jest.mock('@/services/devices/devices.service', () => ({
  ...jest.requireActual<typeof DevicesService>(
    '@/services/devices/devices.service',
  ),
  fetchStationForUser: (s: unknown, p: unknown) => fetchStation(s, p),
}))
const latest = jest.fn<Promise<Reading | null>, [unknown, unknown]>()
const page = jest.fn<Promise<Reading[]>, [unknown, unknown]>()
const bucketed = jest.fn<Promise<BucketedRow[]>, [unknown, unknown]>()
jest.mock('@/services/readings/readings.service', () => ({
  fetchLatestReading: (s: unknown, p: unknown) => latest(s, p),
  fetchReadingsPage: (s: unknown, p: unknown) => page(s, p),
  fetchReadingsBucketed: (s: unknown, p: unknown) => bucketed(s, p),
}))

const NOW = Date.parse('2026-10-01T12:00:00.000Z')
const ID = { stationId: 'ws-abc123' }
const reading = (id: number, timestamp: string): Reading => ({
  id,
  deviceId: 'ws-abc123',
  timestamp,
  temperature: 20,
  humidity: 50,
  pressure: 1013,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})
const raw = (query = '') =>
  rawRoute.GET(apiRequest(`/stations/ws-abc123/readings${query}`), params(ID))
const aggregate = (query = '') =>
  aggregateRoute.GET(
    apiRequest(`/stations/ws-abc123/readings/aggregate${query}`),
    params(ID),
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  fetchStation.mockResolvedValue(stationRow('viewer'))
  page.mockResolvedValue([])
  bucketed.mockResolvedValue([])
})
afterEach(() => jest.restoreAllMocks())

describe('GET …/readings/latest', () => {
  it('returns the reading without internal fields', async () => {
    latest.mockResolvedValue(reading(7, '2026-10-01T11:55:00+00:00'))
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(await res.json()).toEqual({
      data: {
        timestamp: '2026-10-01T11:55:00+00:00',
        temperature: 20,
        humidity: 50,
        pressure: 1013,
        windSpeed: null,
        windDirection: null,
        precipitation: null,
      },
    })
  })

  it('returns null for a station that never reported', async () => {
    latest.mockResolvedValue(null)
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(await res.json()).toEqual({ data: null })
  })

  it('answers 404 to a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    const res = await latestRoute.GET(
      apiRequest('/stations/ws-abc123/readings/latest'),
      params(ID),
    )
    expect(res.status).toBe(404)
    expect(latest).not.toHaveBeenCalled()
  })
})

describe('GET …/readings', () => {
  it('defaults to the last 24 h, 288 rows, no cursor', async () => {
    const res = await raw()
    expect(res.status).toBe(200)
    expect(page).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        from: '2026-09-30T12:00:00.000Z',
        to: '2026-10-01T12:00:00.000Z',
        cursor: null,
        limit: 288,
      },
    )
    expect(await res.json()).toEqual({ data: [], nextCursor: null })
  })

  it('returns a cursor to the last row when the page is full', async () => {
    page.mockResolvedValue([
      reading(1, '2026-10-01T11:50:00+00:00'),
      reading(2, '2026-10-01T11:55:00+00:00'),
    ])
    const body = (await (await raw('?limit=2')).json()) as {
      nextCursor: string
    }
    expect(body.nextCursor).toBe(
      encodeCursor({ timestamp: '2026-10-01T11:55:00+00:00', id: 2 }),
    )
  })

  it('passes a returned cursor back to the service', async () => {
    const cursor = encodeCursor({
      timestamp: '2026-10-01T11:55:00+00:00',
      id: 2,
    })
    await raw(`?cursor=${cursor}`)
    expect(page).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cursor: { timestamp: '2026-10-01T11:55:00+00:00', id: 2 },
      }),
    )
  })

  it.each([
    ['tampered cursor', '?cursor=bm9wZQ'],
    ['limit over max', '?limit=1001'],
    ['span over 31 days', '?from=2026-08-01T00:00:00Z&to=2026-09-02T00:00:00Z'],
    ['from after to', '?from=2026-10-01T00:00:00Z&to=2026-09-01T00:00:00Z'],
    ['unknown parameter', '?form=2026-10-01T00:00:00Z'],
  ])('rejects %s with 400', async (_label, query) => {
    const res = await raw(query)
    expect(res.status).toBe(400)
    expect(page).not.toHaveBeenCalled()
  })

  it('answers 404 to a non-member without reading', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await raw()).status).toBe(404)
    expect(page).not.toHaveBeenCalled()
  })

  it('validates before membership: bad query is 400 for a non-member', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await raw('?limit=0')).status).toBe(400)
    expect(fetchStation).not.toHaveBeenCalled()
  })
})

describe('GET …/readings/aggregate', () => {
  it('defaults to hourly buckets over the last 7 days', async () => {
    const res = await aggregate()
    expect(res.status).toBe(200)
    expect(bucketed).toHaveBeenCalledWith(
      { __brand: 'service' },
      {
        deviceId: 'ws-abc123',
        from: '2026-09-24T12:00:00.000Z',
        to: '2026-10-01T12:00:00.000Z',
        bucketMinutes: 60,
      },
    )
    expect(await res.json()).toEqual({ data: [], interval: '1h' })
  })

  it('allows a year of daily buckets', async () => {
    const res = await aggregate(
      '?interval=1d&from=2025-10-01T00:00:00Z&to=2026-10-01T00:00:00Z',
    )
    expect(res.status).toBe(200)
    expect(bucketed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bucketMinutes: 1440 }),
    )
  })

  it('answers 404 to a non-member without reading', async () => {
    fetchStation.mockResolvedValue(null)
    expect((await aggregate()).status).toBe(404)
    expect(bucketed).not.toHaveBeenCalled()
  })

  // readings_bucketed includes timestamp <= to, so N intervals span N + 1
  // buckets; the cap is 999 intervals to stay within max_rows = 1000.
  it.each([
    ['15m', 15],
    ['1h', 60],
    ['6h', 360],
  ])(
    '%s: exactly 999 intervals passes, one ms more is 400',
    async (interval, minutes) => {
      const to = '2026-10-01T00:00:00.000Z'
      const spanMs = 999 * minutes * 60_000
      const at = new Date(Date.parse(to) - spanMs).toISOString()
      const over = new Date(Date.parse(to) - spanMs - 1).toISOString()
      const ok = await aggregate(`?interval=${interval}&from=${at}&to=${to}`)
      expect(ok.status).toBe(200)
      const bad = await aggregate(`?interval=${interval}&from=${over}&to=${to}`)
      expect(bad.status).toBe(400)
    },
  )

  it.each([
    [
      'more than 1000 hourly buckets',
      '?interval=1h&from=2026-08-01T00:00:00Z&to=2026-09-15T00:00:00Z',
    ],
    ['an unknown interval', '?interval=5m'],
  ])('rejects %s', async (_label, query) => {
    expect((await aggregate(query)).status).toBe(400)
    expect(bucketed).not.toHaveBeenCalled()
  })
})
