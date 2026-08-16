import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
} from '@/services/schedules/schedules.service'

type Result = { data: unknown; error: unknown }
interface Chain {
  select: jest.Mock<Chain, [string]>
  order: jest.Mock<Promise<Result>, [string, { ascending: boolean }]>
  insert: jest.Mock<Chain, [unknown]>
  single: jest.Mock<Promise<Result>, []>
  delete: jest.Mock<Chain, []>
  eq: jest.Mock<Promise<Result>, [string, unknown]>
}
const makeClient = (result: Result) => {
  const chain: Chain = {
    select: jest.fn<Chain, [string]>(() => chain),
    order: jest.fn<Promise<Result>, [string, { ascending: boolean }]>(
      async () => result,
    ),
    insert: jest.fn<Chain, [unknown]>(() => chain),
    single: jest.fn<Promise<Result>, []>(async () => result),
    delete: jest.fn<Chain, []>(() => chain),
    eq: jest.fn<Promise<Result>, [string, unknown]>(async () => result),
  }
  return {
    from: jest.fn(() => chain),
    chain,
  } as unknown as SupabaseClient<Database> & {
    chain: Chain
  }
}

describe('schedules service', () => {
  it('fetchSchedules selects aliased columns ordered by time and trims seconds', async () => {
    const client = makeClient({
      data: [
        {
          id: 1,
          userId: 'u',
          time: '07:30:00',
          timezone: 'UTC',
          days: [1, 2],
          createdAt: 't',
        },
      ],
      error: null,
    })
    await expect(fetchSchedules(client)).resolves.toEqual([
      {
        id: 1,
        userId: 'u',
        time: '07:30',
        timezone: 'UTC',
        days: [1, 2],
        createdAt: 't',
      },
    ])
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, userId:user_id, time, timezone, days, createdAt:created_at',
    )
    expect(client.chain.order).toHaveBeenCalledWith('time', { ascending: true })
  })
  it('createSchedule inserts snake_case', async () => {
    const client = makeClient({
      data: {
        id: 2,
        userId: 'u',
        time: '08:00:00',
        timezone: 'Europe/Kyiv',
        days: [1],
        createdAt: 't',
      },
      error: null,
    })
    await createSchedule(client, {
      userId: 'u',
      time: '8:00',
      timezone: 'Europe/Kyiv',
      days: [1],
    })
    expect(client.chain.insert).toHaveBeenCalledWith({
      user_id: 'u',
      time: '08:00',
      timezone: 'Europe/Kyiv',
      days: [1],
    })
  })
  it('deleteSchedule deletes by id and surfaces ServiceError', async () => {
    const ok = makeClient({ data: null, error: null })
    await deleteSchedule(ok, { id: 3 })
    expect(ok.chain.eq).toHaveBeenCalledWith('id', 3)
    const bad = makeClient({
      data: null,
      error: { message: 'x', code: '42501', details: null },
    })
    await expect(deleteSchedule(bad, { id: 3 })).rejects.toBeInstanceOf(
      ServiceError,
    )
  })
})
