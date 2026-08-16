'use client'

import { useQuery } from '@tanstack/react-query'

import { fetchLatestReading, fetchReadingsHistory } from './readings.service'

import type { HistoryRange } from '@/lib/chart'
import { useSupabaseClient } from '@/lib/supabase'

export const readingKeys = {
  all: ['readings'] as const,
  latest: (deviceId: string) =>
    [...readingKeys.all, 'latest', deviceId] as const,
  history: (deviceId: string, range: HistoryRange) =>
    [...readingKeys.all, 'history', deviceId, range] as const,
}

export const useLatestReadingQuery = (deviceId: string | undefined) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: readingKeys.latest(deviceId ?? ''),
    queryFn: () => fetchLatestReading(client, { deviceId: deviceId! }),
    enabled: !!deviceId,
  })
}

export const useReadingsHistoryQuery = (
  deviceId: string | undefined,
  range: HistoryRange,
) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: readingKeys.history(deviceId ?? '', range),
    queryFn: () => fetchReadingsHistory(client, { deviceId: deviceId!, range }),
    enabled: !!deviceId,
    // Realtime keeps 24h fresh; still refetch on focus so gaps after sleep close quickly.
    refetchOnWindowFocus: true,
  })
}
