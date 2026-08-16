const auth = jest.fn<Promise<{ userId: string | null }>, []>()
const deleteUser = jest.fn<Promise<unknown>, [string]>()
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => auth(),
  clerkClient: async () => ({ users: { deleteUser } }),
}))
const erase = jest.fn<Promise<unknown>, [unknown, string]>()
jest.mock('@/services/users/users.service', () => ({
  deleteUserByClerkId: (c: unknown, p: { clerkUserId: string }) =>
    erase(c, p.clerkUserId),
}))
jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: () => ({}) }))

import { deleteAccountAction } from '@/actions/account.action'

describe('deleteAccountAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
  })
  it('requires the confirmation word', async () => {
    await expect(
      deleteAccountAction({ confirmation: 'nope' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    })
    expect(erase).not.toHaveBeenCalled()
  })
  it('erases the DB rows then the Clerk user', async () => {
    erase.mockResolvedValue({ deletedUsers: 1 })
    deleteUser.mockResolvedValue({})
    await expect(
      deleteAccountAction({ confirmation: 'DELETE ' }),
    ).resolves.toEqual({ ok: true, data: null })
    expect(erase).toHaveBeenCalledWith({}, 'user_1')
    expect(deleteUser).toHaveBeenCalledWith('user_1')
  })
  it('reports PARTIAL when Clerk deletion fails after the DB erase', async () => {
    erase.mockResolvedValue({ deletedUsers: 1 })
    deleteUser.mockRejectedValue(new Error('clerk down'))
    await expect(
      deleteAccountAction({ confirmation: 'delete' }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'PARTIAL',
    })
  })
})
