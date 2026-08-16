import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchMyDevices } from '@/services/devices/devices.service'

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
