import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { eraseUserByClerkId } from '@/lib/account/erase-user'
import { ServiceError } from '@/services/database/types'

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

describe('eraseUserByClerkId', () => {
  it('deletes the users row by clerk id and returns the count', async () => {
    const { client, eq } = make({ data: [{ id: 'u1' }], error: null })
    await expect(eraseUserByClerkId(client, 'user_1')).resolves.toEqual({
      deletedUsers: 1,
    })
    expect(eq).toHaveBeenCalledWith('clerk_user_id', 'user_1')
  })
  it('throws ServiceError on error', async () => {
    const { client } = make({
      data: null,
      error: { message: 'x', code: '42501', details: null },
    })
    await expect(eraseUserByClerkId(client, 'user_1')).rejects.toBeInstanceOf(
      ServiceError,
    )
  })
})
