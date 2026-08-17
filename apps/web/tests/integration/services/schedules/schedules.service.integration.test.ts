import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createUserClient } from '../../helpers/auth-client'

import {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  updateSchedule,
} from '@/services/schedules/schedules.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_sched_a'
const CLERK_B = 'user_inttest_sched_b'

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
})

describe('schedules service (integration, client path)', () => {
  it('CRUD as the owner works; another user sees nothing and cannot touch the rows', async () => {
    const { data: a } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_A })
      .select('id')
      .single()
    await db.from('users').insert({ clerk_user_id: CLERK_B })
    const asA = createUserClient(CLERK_A)
    const asB = createUserClient(CLERK_B)

    const created = await createSchedule(asA, {
      userId: a!.id,
      time: '7:30',
      timezone: 'Europe/Kyiv',
      days: [1, 2, 3, 4, 5],
    })
    expect(created).toMatchObject({
      time: '07:30',
      timezone: 'Europe/Kyiv',
      days: [1, 2, 3, 4, 5],
    })
    expect(await fetchSchedules(asA)).toHaveLength(1)

    const updated = await updateSchedule(asA, {
      id: created.id,
      time: '08:00',
      timezone: 'UTC',
      days: [6, 7],
    })
    expect(updated).toMatchObject({
      time: '08:00',
      timezone: 'UTC',
      days: [6, 7],
    })

    expect(await fetchSchedules(asB)).toEqual([])
    // RLS: B's update/delete affect no rows (PostgREST returns 0 rows → single() errors / delete no-op)
    await expect(
      updateSchedule(asB, {
        id: created.id,
        time: '09:00',
        timezone: 'UTC',
        days: [1],
      }),
    ).rejects.toBeDefined()
    // B's delete matches zero rows because RLS hides A's alert. PostgREST
    // reports no error for that, so the service now raises instead of letting
    // the UI confirm a deletion that never happened.
    await expect(deleteSchedule(asB, { id: created.id })).rejects.toThrow(
      /not found or not yours/i,
    )
    expect(await fetchSchedules(asA)).toHaveLength(1)

    await deleteSchedule(asA, { id: created.id })
    expect(await fetchSchedules(asA)).toEqual([])
  })
})
