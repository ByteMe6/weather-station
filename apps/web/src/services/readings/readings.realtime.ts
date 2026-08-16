'use client'

import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import type { Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'
import { useEffect, useRef, useState } from 'react'

import { readingKeys } from './readings.queries'

import type { HistoryPoint } from '@/lib/chart'
import { toHistoryPoints } from '@/lib/chart'
import { useSupabaseClient } from '@/lib/supabase'

export type RealtimeStatus = 'idle' | 'live' | 'reconnecting' | 'offline'
type ReadingRow = Database['public']['Tables']['readings']['Row']

/**
 * Clerk session tokens live 60 s. supabase-js's constructor pins the first
 * token as "manual" (setAuth(token)), which silently disables its own
 * heartbeat refresh — so we refresh ourselves: a no-arg setAuth() re-runs the
 * accessToken callback and clears that flag.
 */
const AUTH_REFRESH_MS = 30_000
const RESUBSCRIBE_BASE_MS = 2_000
const RESUBSCRIBE_MAX_MS = 30_000

/**
 * Realtime delivers raw snake_case rows (no .select() aliasing is possible),
 * so this is the one place rows are mapped by hand; `numeric` columns arrive
 * as strings despite the typed payload, hence Number().
 */
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
 * reconnect the queries are invalidated to fill any gap. A channel the server
 * closes (token expiry, network) is resubscribed with capped backoff.
 */
export const useReadingsRealtime = (
  deviceId: string | undefined,
): { status: RealtimeStatus; lastEventAt: number | null } => {
  const client = useSupabaseClient()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  // Bumping retryTick re-runs the effect (resubscribe); attempts live in a ref
  // so resetting them on SUBSCRIBED does not itself trigger a resubscribe.
  const [retryTick, setRetryTick] = useState(0)
  const attempts = useRef(0)
  const wasSubscribed = useRef(false)

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false
    let retryTimer: number | null = null

    const channel = client.channel(`readings:${deviceId}`).on(
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
          (prev) =>
            prev && prev.timestamp > reading.timestamp ? prev : reading,
        )
        const point = toHistoryPoints([reading])[0]!
        queryClient.setQueryData<HistoryPoint[] | undefined>(
          readingKeys.history(deviceId, '24h'),
          (prev) => {
            if (prev === undefined || prev.some((p) => p.t === point.t))
              return prev
            // Backfilled rows can arrive out of order; keep the series sorted.
            return [...prev, point].sort((a, b) => a.t - b.t)
          },
        )
        setLastEventAt(Date.now())
      },
    )

    const start = async () => {
      await client.realtime.setAuth()
      if (cancelled) return
      channel.subscribe((s) => {
        if (cancelled) return
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
          attempts.current = 0
          setStatus('live')
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('reconnecting')
        } else if (s === 'CLOSED') {
          setStatus('offline')
          const delay = Math.min(
            RESUBSCRIBE_MAX_MS,
            RESUBSCRIBE_BASE_MS * 2 ** Math.min(attempts.current, 4),
          )
          attempts.current += 1
          retryTimer = window.setTimeout(
            () => setRetryTick((t) => t + 1),
            delay,
          )
        }
      })
    }
    void start()

    const refresh = window.setInterval(() => {
      void client.realtime.setAuth()
    }, AUTH_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(refresh)
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      void client.removeChannel(channel)
    }
  }, [client, deviceId, queryClient, retryTick])

  return { status, lastEventAt }
}
