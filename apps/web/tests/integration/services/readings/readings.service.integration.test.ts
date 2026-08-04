import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import {
  fetchDeviceSecret,
  insertReading,
} from '@/services/readings/readings.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY

const DEVICE_ID = 'ws-inttest-readings'
const SECRET = 'b'.repeat(64)
const payload = {
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 20,
  humidity: 50,
  pressure: 1000,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
}

// Own client built inline (not createServiceRoleClient) so the test avoids the
// `server-only` import; this is the service-role key, so it bypasses RLS.
const db = createClient<Database>(url ?? '', key ?? '')

const seedDevice = async () => {
  const { error } = await db
    .from('devices')
    .insert({ device_id: DEVICE_ID, secret: SECRET, status: 'unregistered' })
  if (error) throw error
}

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  // FK on delete cascade removes the device's readings too.
  await db.from('devices').delete().eq('device_id', DEVICE_ID)
})

describe('readings service (integration)', () => {
  it('fetchDeviceSecret returns the secret for a known device, null for unknown', async () => {
    await seedDevice()
    expect(await fetchDeviceSecret(db, { deviceId: DEVICE_ID })).toBe(SECRET)
    expect(
      await fetchDeviceSecret(db, { deviceId: 'ws-does-not-exist' }),
    ).toBeNull()
  })

  it('insertReading writes one row and treats a duplicate timestamp as a no-op', async () => {
    await seedDevice()
    await insertReading(db, { deviceId: DEVICE_ID, payload })
    await insertReading(db, { deviceId: DEVICE_ID, payload }) // retry of same reading

    const { count } = await db
      .from('readings')
      .select('*', { count: 'exact', head: true })
      .eq('device_id', DEVICE_ID)
    expect(count).toBe(1)
  })

  it('insertReading persists every sensor value', async () => {
    await seedDevice()
    const full = {
      timestamp: '2026-07-21T13:00:00.000Z',
      temperature: 21.5,
      humidity: 60,
      pressure: 1011.3,
      windSpeed: 12.4,
      windDirection: 270,
      precipitation: 3.2,
    }
    await insertReading(db, { deviceId: DEVICE_ID, payload: full })

    const { data, error } = await db
      .from('readings')
      .select(
        'temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation, timestamp',
      )
      .eq('device_id', DEVICE_ID)
      .single()

    expect(error).toBeNull()
    if (!data) throw new Error('expected the inserted reading to be returned')
    // Postgres `numeric` can come back as a string via PostgREST — coerce.
    expect(Number(data.temperature)).toBeCloseTo(21.5)
    expect(Number(data.humidity)).toBeCloseTo(60)
    expect(Number(data.pressure)).toBeCloseTo(1011.3)
    expect(Number(data.windSpeed)).toBeCloseTo(12.4)
    expect(Number(data.windDirection)).toBeCloseTo(270)
    expect(Number(data.precipitation)).toBeCloseTo(3.2)
    expect(new Date(data.timestamp).toISOString()).toBe(
      '2026-07-21T13:00:00.000Z',
    )
  })

  it('persists a reading from a device with no humidity sensor', async () => {
    await seedDevice()
    await insertReading(db, {
      deviceId: DEVICE_ID,
      payload: { ...payload, humidity: null },
    })

    const { data } = await db
      .from('readings')
      .select('humidity')
      .eq('device_id', DEVICE_ID)
      .single()

    expect(data?.humidity).toBeNull()
  })
})
