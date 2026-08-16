import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createUserClient } from '../../helpers/auth-client'

import { fetchMyDevices } from '@/services/devices/devices.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_devices_a'
const CLERK_B = 'user_inttest_devices_b'
const DEVICE_ID = 'ws-inttestdev01'

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('devices').delete().eq('device_id', DEVICE_ID)
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
})

describe('devices service (integration)', () => {
  it('fetchMyDevices returns only the caller’s links; claim_device enforces one owner', async () => {
    const { data: a } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_A })
      .select('id')
      .single()
    const { data: b } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_B })
      .select('id')
      .single()
    await db
      .from('devices')
      .insert({
        device_id: DEVICE_ID,
        secret: 'x'.repeat(64),
        status: 'unregistered',
      })

    const { error: claimA } = await db.rpc('claim_device', {
      p_device_id: DEVICE_ID,
      p_user_id: a!.id,
    })
    expect(claimA).toBeNull()

    const mine = await fetchMyDevices(createUserClient(CLERK_A))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({
      deviceId: DEVICE_ID,
      role: 'owner',
      device: { status: 'registered' },
    })

    expect(await fetchMyDevices(createUserClient(CLERK_B))).toEqual([])

    const { error: claimB } = await db.rpc('claim_device', {
      p_device_id: DEVICE_ID,
      p_user_id: b!.id,
    })
    expect(claimB?.message).toContain('DEVICE_ALREADY_CLAIMED')
  })
})
