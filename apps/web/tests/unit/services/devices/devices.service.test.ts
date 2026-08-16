import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import {
  fetchDeviceMemberIdentities,
  fetchDeviceMembers,
  fetchMemberRole,
  fetchMyDevices,
} from '@/services/devices/devices.service'

interface Chain {
  select: jest.Mock<Chain, [string]>
  order: jest.Mock<
    Promise<{ data: unknown; error: unknown }>,
    [string, { ascending: boolean }]
  >
}

const makeClient = (result: { data: unknown; error: unknown }) => {
  const chain: Chain = {
    select: jest.fn<Chain, [string]>(() => chain),
    order: jest.fn<
      Promise<{ data: unknown; error: unknown }>,
      [string, { ascending: boolean }]
    >(async () => result),
  }
  return {
    from: jest.fn(() => chain),
    chain,
  } as unknown as SupabaseClient<Database> & {
    chain: Chain
  }
}

describe('fetchMyDevices', () => {
  it('selects device links with nested device fields, ordered by added_at', async () => {
    const rows = [
      {
        deviceId: 'WS-1',
        role: 'owner',
        addedAt: 't',
        device: {
          status: 'registered',
          createdAt: 'c',
          label: null,
          address: null,
        },
      },
    ]
    const client = makeClient({ data: rows, error: null })
    await expect(fetchMyDevices(client)).resolves.toEqual(rows)
    expect(client.chain.select).toHaveBeenCalledWith(
      'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at, label, address )',
    )
    expect(client.chain.order).toHaveBeenCalledWith('added_at', {
      ascending: true,
    })
  })
})

describe('fetchDeviceMembers', () => {
  it('calls the device_members RPC and maps rows to camelCase with nullable tails', async () => {
    const rpc = jest.fn(async () => ({
      data: [
        {
          user_id: 'u-a',
          role: 'owner',
          added_at: '2026-08-01T00:00:00Z',
          clerk_tail: '3f2a',
          telegram_tail: null,
        },
      ],
      error: null,
    }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    await expect(
      fetchDeviceMembers(client, { deviceId: 'ws-1' }),
    ).resolves.toEqual([
      {
        userId: 'u-a',
        role: 'owner',
        addedAt: '2026-08-01T00:00:00Z',
        clerkTail: '3f2a',
        telegramTail: null,
      },
    ])
    expect(rpc).toHaveBeenCalledWith('device_members', { p_device_id: 'ws-1' })
  })
  it('throws ServiceError when the RPC fails', async () => {
    const client = {
      rpc: jest.fn(async () => ({
        data: null,
        error: { message: 'x', code: '42501', details: null },
      })),
    } as unknown as SupabaseClient<Database>
    await expect(
      fetchDeviceMembers(client, { deviceId: 'ws-1' }),
    ).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('fetchMemberRole', () => {
  const make = (result: { data: unknown; error: unknown }) => {
    const eq2 = jest.fn(() => ({ maybeSingle: jest.fn(async () => result) }))
    const eq1 = jest.fn(() => ({ eq: eq2 }))
    const select = jest.fn(() => ({ eq: eq1 }))
    return {
      client: {
        from: jest.fn(() => ({ select })),
      } as unknown as SupabaseClient<Database>,
      eq1,
      eq2,
    }
  }
  it('filters by device and user and returns the role', async () => {
    const { client, eq1, eq2 } = make({ data: { role: 'owner' }, error: null })
    await expect(
      fetchMemberRole(client, { deviceId: 'ws-1', userId: 'u-a' }),
    ).resolves.toBe('owner')
    expect(eq1).toHaveBeenCalledWith('device_id', 'ws-1')
    expect(eq2).toHaveBeenCalledWith('user_id', 'u-a')
  })
  it('returns null for a non-member and throws on a DB error', async () => {
    await expect(
      fetchMemberRole(make({ data: null, error: null }).client, {
        deviceId: 'ws-1',
        userId: 'u-a',
      }),
    ).resolves.toBeNull()
    await expect(
      fetchMemberRole(
        make({ data: null, error: { message: 'x', code: '1', details: null } })
          .client,
        { deviceId: 'ws-1', userId: 'u-a' },
      ),
    ).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('fetchDeviceMemberIdentities', () => {
  it('joins users for the full clerk id and nulls Telegram-only members', async () => {
    const eq = jest.fn(async () => ({
      data: [
        { userId: 'u-a', user: { clerkUserId: 'user_2abc' } },
        { userId: 'u-b', user: { clerkUserId: null } },
        { userId: 'u-c', user: null },
      ],
      error: null,
    }))
    const select = jest.fn(() => ({ eq }))
    const client = {
      from: jest.fn(() => ({ select })),
    } as unknown as SupabaseClient<Database>
    await expect(
      fetchDeviceMemberIdentities(client, { deviceId: 'ws-1' }),
    ).resolves.toEqual([
      { userId: 'u-a', clerkUserId: 'user_2abc' },
      { userId: 'u-b', clerkUserId: null },
      { userId: 'u-c', clerkUserId: null },
    ])
    expect(select).toHaveBeenCalledWith(
      'userId:user_id, user:users ( clerkUserId:clerk_user_id )',
    )
    expect(eq).toHaveBeenCalledWith('device_id', 'ws-1')
  })
})
