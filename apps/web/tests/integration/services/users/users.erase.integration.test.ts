import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { deleteUserByClerkId } from '@/services/users/users.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_erase_a'
const DEVICE_ID = 'ws-inttesterase1'

beforeAll(() => {
  if (!url || !key)
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).',
    )
})
afterEach(async () => {
  await db.from('devices').delete().eq('device_id', DEVICE_ID)
  await db.from('users').delete().eq('clerk_user_id', CLERK_A)
})

describe('deleteUserByClerkId (integration)', () => {
  it('removes every row referencing the user, frees the device, keeps readings', async () => {
    const { data: a } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_A })
      .select('id')
      .single()
    await db.from('devices').insert({
      device_id: DEVICE_ID,
      secret: 'x'.repeat(64),
      status: 'registered',
    })
    await db
      .from('device_users')
      .insert({ device_id: DEVICE_ID, user_id: a!.id, role: 'owner' })
    await db
      .from('schedules')
      .insert({ user_id: a!.id, time: '07:30', timezone: 'UTC', days: [1] })
    await db.from('telegram_link_codes').insert({
      code: 'ERASECODE0000000001',
      user_id: a!.id,
      expires_at: new Date().toISOString(),
    })
    await db.from('readings').insert({
      device_id: DEVICE_ID,
      timestamp: '2026-07-01T00:00:00Z',
      temperature: 20,
      humidity: 50,
      pressure: 1000,
    })

    expect(await deleteUserByClerkId(db, { clerkUserId: CLERK_A })).toEqual({
      deletedUsers: 1,
    })

    expect((await db.from('users').select('id').eq('id', a!.id)).data).toEqual(
      [],
    )
    expect(
      (await db.from('device_users').select('user_id').eq('user_id', a!.id))
        .data,
    ).toEqual([])
    expect(
      (await db.from('schedules').select('id').eq('user_id', a!.id)).data,
    ).toEqual([])
    expect(
      (await db.from('telegram_link_codes').select('code').eq('user_id', a!.id))
        .data,
    ).toEqual([])
    expect(
      (
        await db
          .from('devices')
          .select('status')
          .eq('device_id', DEVICE_ID)
          .single()
      ).data?.status,
    ).toBe('unregistered')
    expect(
      (
        await db
          .from('readings')
          .select('id', { count: 'exact', head: true })
          .eq('device_id', DEVICE_ID)
      ).count,
    ).toBe(1)
  })
})
