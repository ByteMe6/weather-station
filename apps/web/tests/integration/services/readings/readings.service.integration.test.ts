import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createUserClient } from '../../helpers/auth-client'

import {
  fetchDeviceSecret,
  fetchLatestReading,
  fetchReadingsBucketed,
  fetchReadingsHistory,
  fetchReadingsPage,
  fetchReadingsRange,
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

const CLERK_MEMBER = 'user_inttest_readings_member'
const CLERK_OTHER = 'user_inttest_readings_other'

afterEach(async () => {
  // FK on delete cascade removes the device's readings too.
  await db.from('devices').delete().eq('device_id', DEVICE_ID)
  await db
    .from('users')
    .delete()
    .in('clerk_user_id', [CLERK_MEMBER, CLERK_OTHER])
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

  it('fetchReadingsRange/latest respect RLS: member sees rows ascending, non-member sees none', async () => {
    await seedDevice()
    const { data: member } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_MEMBER })
      .select('id')
      .single()
    await db.from('users').insert({ clerk_user_id: CLERK_OTHER })
    await db
      .from('device_users')
      .insert({ device_id: DEVICE_ID, user_id: member!.id, role: 'owner' })
    for (const [i, ts] of [
      '2026-07-21T10:00:00.000Z',
      '2026-07-21T11:00:00.000Z',
      '2026-07-21T12:00:00.000Z',
    ].entries()) {
      await insertReading(db, {
        deviceId: DEVICE_ID,
        payload: { ...payload, timestamp: ts, temperature: 20 + i },
      })
    }

    const asMember = createUserClient(CLERK_MEMBER)
    const rows = await fetchReadingsRange(asMember, {
      deviceId: DEVICE_ID,
      from: '2026-07-21T09:00:00.000Z',
      to: '2026-07-21T13:00:00.000Z',
    })
    expect(rows.map((r) => r.temperature)).toEqual([20, 21, 22])
    expect(rows[0]).toMatchObject({ deviceId: DEVICE_ID, windSpeed: null })
    expect(
      await fetchLatestReading(asMember, { deviceId: DEVICE_ID }),
    ).toMatchObject({
      temperature: 22,
    })
    // 7d history is bucketed hourly via readings_bucketed(); the seeded rows are
    // in 2026-07 (outside the live 7d window), so call the RPC directly.
    const buckets = await fetchReadingsBucketed(asMember, {
      deviceId: DEVICE_ID,
      from: '2026-07-21T09:00:00.000Z',
      to: '2026-07-21T13:00:00.000Z',
      bucketMinutes: 60,
    })
    expect(buckets).toHaveLength(3)
    expect(buckets[0]).toMatchObject({
      avgTemperature: 20,
      minTemperature: 20,
      sampleCount: 1,
    })
    expect(
      await fetchReadingsBucketed(createUserClient(CLERK_OTHER), {
        deviceId: DEVICE_ID,
        from: '2026-07-21T09:00:00.000Z',
        to: '2026-07-21T13:00:00.000Z',
        bucketMinutes: 60,
      }),
    ).toEqual([])
    expect(
      await fetchReadingsHistory(asMember, {
        deviceId: DEVICE_ID,
        range: '7d',
      }),
    ).toEqual([])

    // Keyset paging (CSV export): two pages of 2, the cursor from page 1
    // continues exactly where it stopped, and PostgREST's +00:00 offset round-trips.
    const window = {
      deviceId: DEVICE_ID,
      from: '2026-07-21T09:00:00.000Z',
      to: '2026-07-21T13:00:00.000Z',
    }
    const page1 = await fetchReadingsPage(db, {
      ...window,
      cursor: null,
      limit: 2,
    })
    expect(page1.map((r) => r.temperature)).toEqual([20, 21])
    const last = page1[page1.length - 1]!
    const page2 = await fetchReadingsPage(db, {
      ...window,
      cursor: { timestamp: last.timestamp, id: last.id },
      limit: 2,
    })
    expect(page2.map((r) => r.temperature)).toEqual([22])

    const asOther = createUserClient(CLERK_OTHER)
    expect(
      await fetchReadingsRange(asOther, {
        deviceId: DEVICE_ID,
        from: '2026-07-21T09:00:00.000Z',
        to: '2026-07-21T13:00:00.000Z',
      }),
    ).toEqual([])
    expect(
      await fetchLatestReading(asOther, { deviceId: DEVICE_ID }),
    ).toBeNull()
  })
})
