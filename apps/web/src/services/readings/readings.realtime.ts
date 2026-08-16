'use client'

import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import type { Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'
import { useEffect, useRef, useState } from 'react'

import { readingKeys } from './readings.queries'

import { useSupabaseClient } from '@/lib/supabase'

export type RealtimeStatus = 'idle' | 'live' | 'reconnecting' | 'offline'
type ReadingRow = Database['public']['Tables']['readings']['Row']

const toReading = (row: ReadingRow): Reading => ({
  id: row.id,
  deviceId: row.device_id,
  timestamp: row.timestamp,
  temperature: Number(row.temperature),
  humidity: row.humidity === null ? null : Number(row.humidity),
  pressure: Number(row.pressure),
  windSpeed: row.wind_speed === null ? null : Number(row.wind_speed),
  windDirection:
    row.wind_direction === null ? null : Number(row.wind_direction),
  precipitation: row.precipitation === null ? null : Number(row.precipitation),
})

/**
 * Subscribes to INSERTs on readings for one device (MRP-25). New rows are
 * written straight into the TanStack cache (latest + 24h history); after a
 * reconnect the queries are invalidated to fill any gap.
 */
export const useReadingsRealtime = (
  deviceId: string | undefined,
): { status: RealtimeStatus; lastEventAt: number | null } => {
  const client = useSupabaseClient()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const wasSubscribed = useRef(false)

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false

    const channel = client
      .channel(`readings:${deviceId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'readings',
          filter: `device_id=eq.${deviceId}`,
        },
        (payload: RealtimePostgresInsertPayload<ReadingRow>) => {
          const reading = toReading(payload.new)
          queryClient.setQueryData<Reading | null>(
            readingKeys.latest(deviceId),
            reading,
          )
          queryClient.setQueryData<Reading[] | undefined>(
            readingKeys.history(deviceId, '24h'),
            (prev) =>
              prev === undefined
                ? prev
                : prev.some((r) => r.id === reading.id)
                  ? prev
                  : [...prev, reading],
          )
          setLastEventAt(Date.now())
        },
      )

    const start = async () => {
      // No-arg setAuth makes supabase-js run the accessToken callback (Clerk JWT);
      // it re-runs on heartbeat so the socket outlives Clerk's 60 s tokens.
      await client.realtime.setAuth()
      if (cancelled) return
      channel.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (wasSubscribed.current) {
            void queryClient.invalidateQueries({
              queryKey: readingKeys.latest(deviceId),
            })
            void queryClient.invalidateQueries({
              queryKey: [...readingKeys.all, 'history', deviceId],
            })
          }
          wasSubscribed.current = true
          setStatus('live')
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('reconnecting')
        } else if (s === 'CLOSED') {
          setStatus('offline')
        }
      })
    }
    void start()

    return () => {
      cancelled = true
      void client.removeChannel(channel)
    }
  }, [client, deviceId, queryClient])

  return { status, lastEventAt }
}
