const getUserList = jest.fn<
  Promise<{ data: unknown[] }>,
  [{ emailAddress: string[]; limit: number }]
>()
jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({ users: { getUserList } }),
}))

import { findClerkUserIdByEmail } from '@/lib/clerk/lookup'

/** Shape of the subset of Clerk's User object the lookup reads. */
const clerkUser = (
  id: string,
  addresses: { emailAddress: string; status: string }[],
) => ({
  id,
  emailAddresses: addresses.map((a) => ({
    emailAddress: a.emailAddress,
    verification: { status: a.status },
  })),
})

describe('findClerkUserIdByEmail', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the id of the account that owns a verified address', async () => {
    getUserList.mockResolvedValue({
      data: [
        clerkUser('user_a', [
          { emailAddress: 'ada@x.com', status: 'verified' },
        ]),
      ],
    })
    await expect(findClerkUserIdByEmail('ada@x.com')).resolves.toBe('user_a')
    expect(getUserList).toHaveBeenCalledWith({
      emailAddress: ['ada@x.com'],
      limit: 2,
    })
  })

  it('matches the address case-insensitively', async () => {
    getUserList.mockResolvedValue({
      data: [
        clerkUser('user_a', [
          { emailAddress: 'Ada@X.com', status: 'verified' },
        ]),
      ],
    })
    await expect(findClerkUserIdByEmail('ada@x.com')).resolves.toBe('user_a')
  })

  it('returns null when Clerk knows nobody at that address', async () => {
    getUserList.mockResolvedValue({ data: [] })
    await expect(findClerkUserIdByEmail('ghost@x.com')).resolves.toBeNull()
  })

  it('returns null when the address is on the account but unverified', async () => {
    // Otherwise anyone could add a stranger's address to their own Clerk
    // account and be handed access to that stranger's station.
    getUserList.mockResolvedValue({
      data: [
        clerkUser('user_a', [
          { emailAddress: 'ada@x.com', status: 'unverified' },
        ]),
      ],
    })
    await expect(findClerkUserIdByEmail('ada@x.com')).resolves.toBeNull()
  })

  it('returns null when the address is verified on a different account', async () => {
    getUserList.mockResolvedValue({
      data: [
        clerkUser('user_a', [
          { emailAddress: 'other@x.com', status: 'verified' },
        ]),
      ],
    })
    await expect(findClerkUserIdByEmail('ada@x.com')).resolves.toBeNull()
  })

  it('returns null when two accounts match, rather than guessing', async () => {
    getUserList.mockResolvedValue({
      data: [
        clerkUser('user_a', [
          { emailAddress: 'ada@x.com', status: 'verified' },
        ]),
        clerkUser('user_b', [
          { emailAddress: 'ada@x.com', status: 'verified' },
        ]),
      ],
    })
    await expect(findClerkUserIdByEmail('ada@x.com')).resolves.toBeNull()
  })
})
