const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))

const upsert = jest.fn()
const select = jest.fn()
const single = jest.fn()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      upsert: (...a: unknown[]) => {
        upsert(...a)
        return {
          select: (...s: unknown[]) => {
            select(...s)
            return { single }
          },
        }
      },
    }),
  }),
}))

import { ensureCurrentUserAction } from '@/actions/users.action'

describe('ensureCurrentUserAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns UNAUTHORIZED without a Clerk session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(ensureCurrentUserAction()).resolves.toMatchObject({
      ok: false,
      code: 'UNAUTHORIZED',
    })
  })

  it('upserts by clerk_user_id and returns the internal id', async () => {
    auth.mockResolvedValue({ userId: 'user_1' })
    single.mockResolvedValue({ data: { id: 'uuid-1' }, error: null })
    await expect(ensureCurrentUserAction()).resolves.toEqual({
      ok: true,
      data: { userId: 'uuid-1' },
    })
    expect(upsert).toHaveBeenCalledWith(
      { clerk_user_id: 'user_1' },
      { onConflict: 'clerk_user_id', ignoreDuplicates: false },
    )
    expect(select).toHaveBeenCalledWith('id')
  })
})
