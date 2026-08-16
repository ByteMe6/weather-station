import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import {
  fetchDeviceMembers,
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
        device: { status: 'registered', createdAt: 'c' },
      },
    ]
    const client = makeClient({ data: rows, error: null })
    await expect(fetchMyDevices(client)).resolves.toEqual(rows)
    expect(client.chain.select).toHaveBeenCalledWith(
      'deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at )',
    )
    expect(client.chain.order).toHaveBeenCalledWith('added_at', {
      ascending: true,
    })
  })
})

describe('fetchDeviceMembers', () => {
  it('selects members with nested user identifiers', async () => {
    interface MChain {
      select: jest.Mock<MChain, [string]>
      eq: jest.Mock<MChain, [string, string]>
      order: jest.Mock<
        Promise<{ data: unknown; error: unknown }>,
        [string, { ascending: boolean }]
      >
    }
    const chain: MChain = {
      select: jest.fn<MChain, [string]>(() => chain),
      eq: jest.fn<MChain, [string, string]>(() => chain),
      order: jest.fn<
        Promise<{ data: unknown; error: unknown }>,
        [string, { ascending: boolean }]
      >(async () => ({ data: [], error: null })),
    }
    const client = {
      from: jest.fn(() => chain),
    } as unknown as SupabaseClient<Database>
    await fetchDeviceMembers(client, { deviceId: 'WS-1' })
    expect(chain.select).toHaveBeenCalledWith(
      'deviceId:device_id, userId:user_id, role, addedAt:added_at, user:users ( clerkUserId:clerk_user_id, telegramId:telegram_id )',
    )
    expect(chain.eq).toHaveBeenCalledWith('device_id', 'WS-1')
  })
})
