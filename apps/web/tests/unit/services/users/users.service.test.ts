import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import {
  deleteUserByClerkId,
  fetchCurrentUser,
  fetchUserIdByClerkId,
} from '@/services/users/users.service'

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

describe('fetchUserIdByClerkId', () => {
  const make = (result: { data: unknown; error: unknown }) => {
    const eq = jest.fn(() => ({ maybeSingle: jest.fn(async () => result) }))
    const select = jest.fn(() => ({ eq }))
    return {
      client: {
        from: jest.fn(() => ({ select })),
      } as unknown as SupabaseClient<Database>,
      eq,
    }
  }
  it('filters by clerk_user_id and returns the internal id', async () => {
    const { client, eq } = make({ data: { id: 'u1' }, error: null })
    await expect(
      fetchUserIdByClerkId(client, { clerkUserId: 'user_1' }),
    ).resolves.toBe('u1')
    expect(eq).toHaveBeenCalledWith('clerk_user_id', 'user_1')
  })
  it('returns null before the users row exists', async () => {
    const { client } = make({ data: null, error: null })
    await expect(
      fetchUserIdByClerkId(client, { clerkUserId: 'user_1' }),
    ).resolves.toBeNull()
  })
  it('throws ServiceError on a DB error (callers must not read it as "not found")', async () => {
    const { client } = make({
      data: null,
      error: { message: 'down', code: '08006', details: null },
    })
    await expect(
      fetchUserIdByClerkId(client, { clerkUserId: 'user_1' }),
    ).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('deleteUserByClerkId', () => {
  const make = (result: { data: unknown; error: unknown }) => {
    const eq = jest.fn(() => ({ select: jest.fn(async () => result) }))
    const del = jest.fn(() => ({ eq }))
    return {
      client: {
        from: jest.fn(() => ({ delete: del })),
      } as unknown as SupabaseClient<Database>,
      eq,
    }
  }
  it('deletes the users row by clerk id and returns the count', async () => {
    const { client, eq } = make({ data: [{ id: 'u1' }], error: null })
    await expect(
      deleteUserByClerkId(client, { clerkUserId: 'user_1' }),
    ).resolves.toEqual({ deletedUsers: 1 })
    expect(eq).toHaveBeenCalledWith('clerk_user_id', 'user_1')
  })
  it('throws ServiceError on error', async () => {
    const { client } = make({
      data: null,
      error: { message: 'x', code: '42501', details: null },
    })
    await expect(
      deleteUserByClerkId(client, { clerkUserId: 'user_1' }),
    ).rejects.toBeInstanceOf(ServiceError)
  })
})
