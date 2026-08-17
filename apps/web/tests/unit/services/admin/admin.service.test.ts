import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchAllDevices, fetchAllUsers } from '@/services/admin/admin.service'
import { ServiceError } from '@/services/database/types'

interface Chain {
  select: jest.Mock<Chain, [string]>
  order: jest.Mock<
    Promise<{ data: unknown; error: unknown }>,
    [string, unknown]
  >
}

const clientReturning = (result: { data: unknown; error: unknown }) => {
  const chain: Chain = {
    select: jest.fn<Chain, [string]>(() => chain),
    order: jest.fn<
      Promise<{ data: unknown; error: unknown }>,
      [string, unknown]
    >(async () => result),
  }
  return {
    client: {
      from: jest.fn(() => chain),
    } as unknown as SupabaseClient<Database>,
    chain,
  }
}

describe('fetchAllDevices', () => {
  it('aliases columns and counts members from the embedded links', async () => {
    const { client, chain } = clientReturning({
      data: [
        {
          deviceId: 'ws-1',
          status: 'registered',
          label: 'Backyard',
          createdAt: '2026-08-01T00:00:00Z',
          members: [{ count: 2 }],
        },
      ],
      error: null,
    })
    await expect(fetchAllDevices(client)).resolves.toEqual([
      {
        deviceId: 'ws-1',
        status: 'registered',
        label: 'Backyard',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 2,
      },
    ])
    expect(chain.select).toHaveBeenCalledWith(
      'deviceId:device_id, status, label, createdAt:created_at, members:device_users(count)',
    )
  })

  it('throws ServiceError when RLS refuses', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'denied', code: '42501', details: null },
    })
    await expect(fetchAllDevices(client)).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('fetchAllUsers', () => {
  it('aliases columns and counts each user’s stations', async () => {
    const { client, chain } = clientReturning({
      data: [
        {
          id: 'u1',
          clerkUserId: 'user_abcd',
          telegramId: null,
          createdAt: '2026-08-01T00:00:00Z',
          devices: [{ count: 3 }],
        },
      ],
      error: null,
    })
    await expect(fetchAllUsers(client)).resolves.toEqual([
      {
        id: 'u1',
        clerkUserId: 'user_abcd',
        telegramId: null,
        createdAt: '2026-08-01T00:00:00Z',
        deviceCount: 3,
      },
    ])
    expect(chain.select).toHaveBeenCalledWith(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at, devices:device_users(count)',
    )
  })
})
