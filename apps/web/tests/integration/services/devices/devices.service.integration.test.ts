import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createUserClient } from '../../helpers/auth-client'

import {
  fetchDeviceMembers,
  fetchMyDevices,
} from '@/services/devices/devices.service'

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
    await db.from('devices').insert({
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

  it('sharing: owner lists all members, viewer sees only self and cannot write device_users', async () => {
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
    await db.from('devices').insert({
      device_id: DEVICE_ID,
      secret: 'x'.repeat(64),
      status: 'registered',
    })
    await db.from('device_users').insert([
      { device_id: DEVICE_ID, user_id: a!.id, role: 'owner' },
      { device_id: DEVICE_ID, user_id: b!.id, role: 'viewer' },
    ])

    const asOwner = await fetchDeviceMembers(createUserClient(CLERK_A), {
      deviceId: DEVICE_ID,
    })
    expect(asOwner.map((m) => m.role).sort()).toEqual(['owner', 'viewer'])
    expect(asOwner.find((m) => m.role === 'viewer')?.user).toMatchObject({
      clerkUserId: CLERK_B,
    })

    const viewerClient = createUserClient(CLERK_B)
    const asViewer = await fetchDeviceMembers(viewerClient, {
      deviceId: DEVICE_ID,
    })
    expect(asViewer).toHaveLength(1)
    expect(asViewer[0]).toMatchObject({ role: 'viewer' })

    const { error: writeErr } = await viewerClient
      .from('device_users')
      .delete()
      .eq('device_id', DEVICE_ID)
      .eq('user_id', a!.id)
    // RLS: no delete policy for authenticated → PostgREST returns 42501 or affects 0 rows.
    const stillOwner = await db
      .from('device_users')
      .select('role')
      .eq('device_id', DEVICE_ID)
      .eq('user_id', a!.id)
      .maybeSingle()
    expect(
      writeErr?.code === '42501' || stillOwner.data?.role === 'owner',
    ).toBe(true)
    expect(stillOwner.data?.role).toBe('owner')
  })
})
