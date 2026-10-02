import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import {
  DEVICE_PROFILE_FORBIDDEN,
  fetchStationForUser,
  fetchStationsForUser,
  writeDeviceProfile,
} from '@/services/devices/devices.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_stations_a'
const CLERK_B = 'user_inttest_stations_b'
const DEV_A = 'ws-inttststa01'
const DEV_B = 'ws-inttststa02'

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

const makeOwnedDevice = async (deviceId: string, owner: string) => {
  await db.from('devices').insert({
    device_id: deviceId,
    secret: 'x'.repeat(64),
    status: 'unregistered',
  })
  const { error } = await db.rpc('claim_device', {
    p_device_id: deviceId,
    p_user_id: owner,
  })
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
  await db.from('devices').delete().in('device_id', [DEV_A, DEV_B])
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
})

describe('station services on the service-role client (integration)', () => {
  it('fetchStationsForUser returns only that user’s stations, with their role', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)
    await makeOwnedDevice(DEV_B, b)
    await db
      .from('device_users')
      .insert({ device_id: DEV_B, user_id: a, role: 'viewer' })

    const forA = await fetchStationsForUser(db, { userId: a })
    expect(forA.map((s) => [s.deviceId, s.role])).toEqual([
      [DEV_A, 'owner'],
      [DEV_B, 'viewer'],
    ])
    const forB = await fetchStationsForUser(db, { userId: b })
    expect(forB.map((s) => s.deviceId)).toEqual([DEV_B])
  })

  it('fetchStationForUser returns null for a station the user is not on', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)

    await expect(
      fetchStationForUser(db, { userId: b, deviceId: DEV_A }),
    ).resolves.toBeNull()
    await expect(
      fetchStationForUser(db, { userId: a, deviceId: DEV_A }),
    ).resolves.toMatchObject({ deviceId: DEV_A, role: 'owner' })
  })

  it('writeDeviceProfile stores all four values and reports a refused role', async () => {
    const a = await makeUser(CLERK_A)
    const b = await makeUser(CLERK_B)
    await makeOwnedDevice(DEV_A, a)
    await db
      .from('device_users')
      .insert({ device_id: DEV_A, user_id: b, role: 'viewer' })

    await expect(
      writeDeviceProfile(db, {
        deviceId: DEV_A,
        userId: a,
        profile: {
          label: 'Roof',
          address: '1 Main St',
          latitude: 50.45,
          longitude: 30.52,
        },
      }),
    ).resolves.toEqual({
      label: 'Roof',
      address: '1 Main St',
      latitude: 50.45,
      longitude: 30.52,
    })

    const refused = writeDeviceProfile(db, {
      deviceId: DEV_A,
      userId: b,
      profile: { label: 'X', address: null, latitude: null, longitude: null },
    })
    await expect(refused).rejects.toBeInstanceOf(ServiceError)
    await expect(refused).rejects.toMatchObject({
      message: DEVICE_PROFILE_FORBIDDEN,
      code: 'P0001',
    })
  })
})
