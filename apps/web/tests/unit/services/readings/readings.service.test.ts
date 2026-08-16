import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import {
  fetchReadingsHistory,
  fetchReadingsRange,
} from '@/services/readings/readings.service'

type Result = { data: unknown; error: unknown }
interface Chain {
  select: jest.Mock<Chain, [string]>
  eq: jest.Mock<Chain, [string, string]>
  gte: jest.Mock<Chain, [string, string]>
  lte: jest.Mock<Chain, [string, string]>
  order: jest.Mock<Chain, [string, { ascending: boolean }]>
  limit: jest.Mock<Promise<Result>, [number]>
}

const makeClient = (result: Result) => {
  const chain: Chain = {
    select: jest.fn<Chain, [string]>(() => chain),
    eq: jest.fn<Chain, [string, string]>(() => chain),
    gte: jest.fn<Chain, [string, string]>(() => chain),
    lte: jest.fn<Chain, [string, string]>(() => chain),
    order: jest.fn<Chain, [string, { ascending: boolean }]>(() => chain),
    limit: jest.fn<Promise<Result>, [number]>(async () => result),
  }
  return {
    from: jest.fn(() => chain),
    chain,
  } as unknown as SupabaseClient<Database> & {
    chain: Chain
  }
}

describe('fetchReadingsRange', () => {
  it('filters by device and timestamp window using the index, ascending, capped', async () => {
    const client = makeClient({ data: [], error: null })
    await fetchReadingsRange(client, {
      deviceId: 'WS-1',
      from: '2026-08-14T12:00:00.000Z',
      to: '2026-08-15T12:00:00.000Z',
    })
    expect(client.chain.eq).toHaveBeenCalledWith('device_id', 'WS-1')
    expect(client.chain.gte).toHaveBeenCalledWith(
      'timestamp',
      '2026-08-14T12:00:00.000Z',
    )
    expect(client.chain.lte).toHaveBeenCalledWith(
      'timestamp',
      '2026-08-15T12:00:00.000Z',
    )
    expect(client.chain.order).toHaveBeenCalledWith('timestamp', {
      ascending: true,
    })
    expect(client.chain.limit).toHaveBeenCalledWith(2000)
  })
})

describe('fetchReadingsHistory', () => {
  it('rejects ranges Plan 1 does not support yet', async () => {
    const client = makeClient({ data: [], error: null })
    await expect(
      fetchReadingsHistory(client, { deviceId: 'WS-1', range: '7d' }),
    ).rejects.toMatchObject({ code: 'RANGE_NOT_SUPPORTED' })
  })
})
