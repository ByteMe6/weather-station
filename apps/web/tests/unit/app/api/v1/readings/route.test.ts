import { createHmac } from 'node:crypto'

import {
  DEVICE_ID_HEADER,
  REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '@ws/shared'

jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: jest.fn(() => ({ __brand: 'client' })),
}))
jest.mock('@/services/readings/readings.service', () => ({
  fetchDeviceSecret: jest.fn(),
  insertReading: jest.fn(),
}))

import { POST } from '@/app/api/v1/readings/route'
import {
  fetchDeviceSecret,
  insertReading,
} from '@/services/readings/readings.service'

const mockFetchSecret = fetchDeviceSecret as jest.MockedFunction<
  typeof fetchDeviceSecret
>
const mockInsert = insertReading as jest.MockedFunction<typeof insertReading>

const SECRET = 'a'.repeat(64)
const NOW = 1_721_563_200_000
const DEVICE_ID = 'ws-test'

const validBody = JSON.stringify({
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 21.4,
  humidity: 55,
  pressure: 1013.2,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})

const sign = (timestamp: string, body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

const makeRequest = (opts: {
  deviceId?: string | null
  timestamp?: string | null
  signature?: string | null
  body?: string
}): Request => {
  const timestamp = opts.timestamp === undefined ? String(NOW) : opts.timestamp
  const body = opts.body ?? validBody
  const signature =
    opts.signature === undefined ? sign(timestamp ?? '', body) : opts.signature
  const headers = new Headers()
  const deviceId = opts.deviceId === undefined ? DEVICE_ID : opts.deviceId
  if (deviceId !== null) headers.set(DEVICE_ID_HEADER, deviceId)
  if (timestamp !== null) headers.set(TIMESTAMP_HEADER, timestamp)
  if (signature !== null) headers.set(SIGNATURE_HEADER, signature)
  return new Request('http://localhost/api/v1/readings', {
    method: 'POST',
    headers,
    body,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(NOW)
  mockFetchSecret.mockResolvedValue(SECRET)
  mockInsert.mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('POST /api/v1/readings', () => {
  it('accepts a valid signed reading (201) and inserts it', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsert.mock.calls[0]?.[1]).toMatchObject({ deviceId: DEVICE_ID })
  })

  it('returns 401 for an unknown device', async () => {
    mockFetchSecret.mockResolvedValue(null)
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(401)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 401 for a bad signature', async () => {
    const res = await POST(makeRequest({ signature: 'deadbeef' }))
    expect(res.status).toBe(401)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 401 for a stale/replayed timestamp before any DB lookup', async () => {
    const stale = String(NOW - 400_000)
    const res = await POST(makeRequest({ timestamp: stale }))
    expect(res.status).toBe(401)
    expect(mockFetchSecret).not.toHaveBeenCalled()
  })

  it('returns 401 when a required header is missing', async () => {
    const res = await POST(makeRequest({ signature: null }))
    expect(res.status).toBe(401)
  })

  it('returns 400 for an out-of-range sensor value', async () => {
    const body = JSON.stringify({
      timestamp: '2026-07-21T12:00:00.000Z',
      temperature: 999,
      humidity: 55,
      pressure: 1013.2,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    })
    const res = await POST(
      makeRequest({ body, signature: sign(String(NOW), body) }),
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: 'invalid_payload',
    })
  })

  it('returns 400 for a non-JSON body', async () => {
    const body = 'not json'
    const res = await POST(
      makeRequest({ body, signature: sign(String(NOW), body) }),
    )
    expect(res.status).toBe(400)
  })

  it('still returns 201 when the insert is a duplicate no-op', async () => {
    mockInsert.mockResolvedValue(undefined) // service swallows conflicts
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(201)
  })

  it('returns 401 for a future timestamp beyond the window, before any DB lookup', async () => {
    const future = String(NOW + 400_000)
    const res = await POST(makeRequest({ timestamp: future }))
    expect(res.status).toBe(401)
    expect(mockFetchSecret).not.toHaveBeenCalled()
  })

  it('accepts a timestamp exactly at the replay-window edge', async () => {
    const edge = String(NOW - REPLAY_WINDOW_MS)
    const res = await POST(makeRequest({ timestamp: edge }))
    expect(res.status).toBe(201)
  })

  it('returns 401 one millisecond past the replay window', async () => {
    const justOutside = String(NOW - REPLAY_WINDOW_MS - 1)
    const res = await POST(makeRequest({ timestamp: justOutside }))
    expect(res.status).toBe(401)
    expect(mockFetchSecret).not.toHaveBeenCalled()
  })

  it('returns 401 for a non-numeric timestamp, before any DB lookup', async () => {
    const res = await POST(makeRequest({ timestamp: 'not-a-number' }))
    expect(res.status).toBe(401)
    expect(mockFetchSecret).not.toHaveBeenCalled()
  })

  it('returns 401 when the timestamp is altered without re-signing', async () => {
    // Signature covers NOW; the header carries a different (still-fresh)
    // timestamp, so the replay check passes but the HMAC no longer matches.
    // Proves x-timestamp is bound into the signature.
    const res = await POST(
      makeRequest({
        timestamp: String(NOW + 1_000),
        signature: sign(String(NOW), validBody),
      }),
    )
    expect(res.status).toBe(401)
    expect(mockFetchSecret).toHaveBeenCalled() // got past the replay check
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 401 for a full-length but forged signature', async () => {
    // 64 hex chars (32 bytes) — correct length, wrong value — so this exercises
    // the constant-time comparison, not the length short-circuit.
    const res = await POST(makeRequest({ signature: 'a'.repeat(64) }))
    expect(res.status).toBe(401)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns 500 when the insert fails unexpectedly', async () => {
    mockInsert.mockRejectedValue(new Error('db unavailable'))
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toMatchObject({ error: 'internal_error' })
  })
})
