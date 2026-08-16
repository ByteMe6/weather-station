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
  it('24h returns raw rows as history points', async () => {
    const client = makeClient({
      data: [
        {
          id: 1,
          deviceId: 'WS-1',
          timestamp: '2026-08-15T12:00:00.000Z',
          temperature: 20,
          humidity: 50,
          pressure: 1000,
          windSpeed: null,
          windDirection: null,
          precipitation: null,
        },
      ],
      error: null,
    })
    const pts = await fetchReadingsHistory(client, {
      deviceId: 'WS-1',
      range: '24h',
    })
    expect(pts[0]).toMatchObject({
      temperature: 20,
      t: new Date('2026-08-15T12:00:00.000Z').getTime(),
    })
  })

  it('7d calls the bucketed RPC with 60-minute buckets and maps bands', async () => {
    const rpc = jest.fn(async () => ({
      data: [
        {
          bucket: '2026-08-15T12:00:00+00:00',
          avg_temperature: 11,
          min_temperature: 10,
          max_temperature: 12,
          avg_humidity: null,
          min_humidity: null,
          max_humidity: null,
          avg_pressure: 1000,
          min_pressure: 1000,
          max_pressure: 1000,
          avg_wind_speed: null,
          max_wind_speed: null,
          total_precipitation: null,
          sample_count: 2,
        },
      ],
      error: null,
    }))
    const client = { rpc } as unknown as SupabaseClient<Database>
    const pts = await fetchReadingsHistory(client, {
      deviceId: 'WS-1',
      range: '7d',
    })
    expect(rpc).toHaveBeenCalledWith(
      'readings_bucketed',
      expect.objectContaining({ p_device_id: 'WS-1', p_bucket_minutes: 60 }),
    )
    expect(pts[0]).toMatchObject({
      temperature: 11,
      temperatureMin: 10,
      temperatureMax: 12,
    })
  })
})
