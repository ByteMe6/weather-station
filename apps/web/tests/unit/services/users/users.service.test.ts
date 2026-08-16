import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import { fetchCurrentUser } from '@/services/users/users.service'

interface Chain {
  select: jest.Mock<Chain, [string]>
  maybeSingle: jest.Mock<Promise<{ data: unknown; error: unknown }>, []>
}

const makeClient = (result: { data: unknown; error: unknown }) => {
  const chain: Chain = {
    select: jest.fn<Chain, [string]>(() => chain),
    maybeSingle: jest.fn(async () => result),
  }
  return {
    from: jest.fn(() => chain),
    chain,
  } as unknown as SupabaseClient<Database> & {
    chain: Chain
  }
}

describe('fetchCurrentUser', () => {
  it('returns the aliased row', async () => {
    const client = makeClient({
      data: {
        id: 'u1',
        clerkUserId: 'user_1',
        telegramId: null,
        createdAt: 't',
      },
      error: null,
    })
    await expect(fetchCurrentUser(client)).resolves.toEqual({
      id: 'u1',
      clerkUserId: 'user_1',
      telegramId: null,
      createdAt: 't',
    })
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at',
    )
  })
  it('returns null when RLS yields no row', async () => {
    const client = makeClient({ data: null, error: null })
    await expect(fetchCurrentUser(client)).resolves.toBeNull()
  })
  it('throws ServiceError on error', async () => {
    const client = makeClient({
      data: null,
      error: { message: 'boom', code: '42501', details: null },
    })
    await expect(fetchCurrentUser(client)).rejects.toBeInstanceOf(ServiceError)
  })
})
