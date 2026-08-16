'use client'

import { useUser } from '@clerk/nextjs'
import type { Reading } from '@ws/shared'
import { useEffect, useMemo, useState } from 'react'

import { useRangeParam } from '@/components/charts/useRangeParam'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'
import {
  useLatestReadingQuery,
  useReadingsHistoryQuery,
} from '@/services/readings/readings.queries'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'
import { useReadingsRealtime } from '@/services/readings/readings.realtime'

export interface DashboardData {
  isLoading: boolean
  deviceId: string | null
  latest: Reading | null
  points: HistoryPoint[]
  status: RealtimeStatus
  now: Date
  error: unknown
  /** Chart range from ?range= (strip/cards always use the 24h series). */
  range: HistoryRange
  setRange: (r: HistoryRange) => void
  chartPoints: HistoryPoint[]
  chartLoading: boolean
  chartError: boolean
}

/** One hook per page: devices → first device → latest + 24h history + realtime. `now` ticks every 30 s for relative labels. */
export const useDashboardData = (): DashboardData => {
  const { isLoaded: isUserLoaded } = useUser()
  const devices = useMyDevicesQuery()
  const deviceId = devices.data?.[0]?.deviceId ?? null
  const latest = useLatestReadingQuery(deviceId ?? undefined)
  const history = useReadingsHistoryQuery(deviceId ?? undefined, '24h')
  const [range, setRange] = useRangeParam()
  // Same key as `history` when range is 24h → TanStack dedups the fetch.
  const chartHistory = useReadingsHistoryQuery(deviceId ?? undefined, range)
  const { status } = useReadingsRealtime(deviceId ?? undefined)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const points = useMemo(() => history.data ?? [], [history.data])
  const chartPoints = useMemo(
    () => chartHistory.data ?? [],
    [chartHistory.data],
  )

  const isLoading =
    !isUserLoaded ||
    devices.isLoading ||
    (deviceId !== null && (latest.isLoading || history.isLoading))

  return {
    isLoading,
    deviceId,
    latest: latest.data ?? null,
    points,
    status,
    now,
    error: devices.error ?? latest.error ?? history.error ?? null,
    range,
    setRange,
    chartPoints,
    chartLoading: chartHistory.isLoading,
    chartError: chartHistory.isError,
  }
}
