/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

type Handler = (payload: { new: Record<string, unknown> }) => void
type StatusCb = (status: string) => void
interface FakeChannel {
  on: jest.Mock<FakeChannel, [string, unknown, Handler]>
  subscribe: jest.Mock<FakeChannel, [StatusCb]>
}
const fake = {
  handler: null as Handler | null,
  statusCb: null as StatusCb | null,
  removed: false,
  setAuth: jest.fn(async () => undefined),
}
const channel: FakeChannel = {
  on: jest.fn<FakeChannel, [string, unknown, Handler]>((_e, _f, h) => {
    fake.handler = h
    return channel
  }),
  subscribe: jest.fn<FakeChannel, [StatusCb]>((cb) => {
    fake.statusCb = cb
    return channel
  }),
}
const client = {
  channel: jest.fn(() => channel),
  removeChannel: jest.fn(async () => {
    fake.removed = true
    return 'ok'
  }),
  realtime: { setAuth: fake.setAuth },
}
jest.mock('@/lib/supabase', () => ({ useSupabaseClient: () => client }))

import { readingKeys } from '@/services/readings/readings.queries'
import { useReadingsRealtime } from '@/services/readings/readings.realtime'

describe('useReadingsRealtime', () => {
  it('upserts latest + 24h history on INSERT and invalidates on reconnect', async () => {
    const qc = new QueryClient()
    qc.setQueryData(readingKeys.history('WS-1', '24h'), [])
    const invalidate = jest.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result, unmount } = renderHook(() => useReadingsRealtime('WS-1'), {
      wrapper,
    })

    // subscribe happens after setAuth resolves
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      fake.statusCb?.('SUBSCRIBED')
    })
    expect(result.current.status).toBe('live')
    expect(channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: 'INSERT',
        table: 'readings',
        filter: 'device_id=eq.WS-1',
      }),
      expect.any(Function),
    )

    await act(async () => {
      fake.handler?.({
        new: {
          id: 9,
          device_id: 'WS-1',
          timestamp: '2026-08-15T12:35:00Z',
          temperature: 21.4,
          humidity: 58,
          pressure: 1013.2,
          wind_speed: null,
          wind_direction: null,
          precipitation: null,
        },
      })
    })
    expect(qc.getQueryData(readingKeys.latest('WS-1'))).toMatchObject({
      id: 9,
      deviceId: 'WS-1',
      temperature: 21.4,
    })
    expect(qc.getQueryData(readingKeys.history('WS-1', '24h'))).toEqual([
      expect.objectContaining({
        temperature: 21.4,
        t: new Date('2026-08-15T12:35:00Z').getTime(),
      }),
    ])

    await act(async () => {
      fake.statusCb?.('CHANNEL_ERROR')
    })
    expect(result.current.status).toBe('reconnecting')
    await act(async () => {
      fake.statusCb?.('SUBSCRIBED')
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: readingKeys.latest('WS-1'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [...readingKeys.all, 'history', 'WS-1'],
    })

    unmount()
    expect(fake.removed).toBe(true)
  })

  it('refreshes realtime auth on an interval and resubscribes after CLOSED', async () => {
    jest.useFakeTimers()
    try {
      const qc = new QueryClient()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      )
      channel.subscribe.mockClear()
      fake.setAuth.mockClear()
      const { result, unmount } = renderHook(
        () => useReadingsRealtime('WS-2'),
        { wrapper },
      )
      await act(async () => {
        await Promise.resolve()
      })
      expect(channel.subscribe).toHaveBeenCalledTimes(1)
      const authCallsAfterMount = fake.setAuth.mock.calls.length

      // Interval refresh: no-arg setAuth() re-runs the accessToken callback and clears
      // supabase-js's "manual token" flag (which otherwise disables heartbeat refresh).
      await act(async () => {
        jest.advanceTimersByTime(30_000)
      })
      expect(fake.setAuth.mock.calls.length).toBeGreaterThan(
        authCallsAfterMount,
      )
      expect(fake.setAuth).toHaveBeenLastCalledWith()

      // Server closed the channel (e.g. token expiry): resubscribe after backoff.
      await act(async () => {
        fake.statusCb?.('CLOSED')
      })
      expect(result.current.status).toBe('offline')
      await act(async () => {
        jest.advanceTimersByTime(2_000)
        await Promise.resolve()
      })
      expect(channel.subscribe).toHaveBeenCalledTimes(2)
      unmount()
    } finally {
      jest.useRealTimers()
    }
  })
})
