const getUserList = jest.fn<
  Promise<{ data: unknown[] }>,
  [{ userId: string[]; limit: number }]
>()
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList } }),
}))

import { fetchClerkProfiles } from '@/lib/clerk/profiles'

describe('fetchClerkProfiles', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns an empty map without calling Clerk for no ids', async () => {
    expect((await fetchClerkProfiles([])).size).toBe(0)
    expect(getUserList).not.toHaveBeenCalled()
  })

  it('maps full name → username → null and drops unknown ids', async () => {
    getUserList.mockResolvedValue({
      data: [
        {
          id: 'user_a',
          fullName: 'Ada Lovelace',
          username: 'ada',
          imageUrl: 'https://img/a',
          primaryEmailAddress: { emailAddress: 'ada@x.com' },
        },
        {
          id: 'user_b',
          fullName: null,
          username: 'bob',
          imageUrl: '',
          primaryEmailAddress: { emailAddress: 'bob@x.com' },
        },
        {
          id: 'user_c',
          fullName: null,
          username: null,
          imageUrl: 'x',
          primaryEmailAddress: null,
        },
      ],
    })
    const out = await fetchClerkProfiles([
      'user_a',
      'user_b',
      'user_c',
      'user_zz',
      'user_a',
    ])
    expect(out.get('user_a')).toEqual({
      name: 'Ada Lovelace',
      avatarUrl: 'https://img/a',
      email: 'ada@x.com',
    })
    expect(out.get('user_b')).toEqual({
      name: 'bob',
      avatarUrl: null,
      email: 'bob@x.com',
    })
    expect(out.get('user_c')).toEqual({
      name: null,
      avatarUrl: 'x',
      email: null,
    })
    expect(out.has('user_zz')).toBe(false)
    // deduplicated, single batch
    expect(getUserList).toHaveBeenCalledTimes(1)
    expect(getUserList.mock.calls[0]![0].userId).toEqual([
      'user_a',
      'user_b',
      'user_c',
      'user_zz',
    ])
  })

  it('batches ids 100 at a time', async () => {
    getUserList.mockResolvedValue({ data: [] })
    await fetchClerkProfiles(Array.from({ length: 150 }, (_, i) => `user_${i}`))
    expect(getUserList).toHaveBeenCalledTimes(2)
    expect(getUserList.mock.calls[0]![0].userId).toHaveLength(100)
    expect(getUserList.mock.calls[1]![0].userId).toHaveLength(50)
  })
})
