'use client'

import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'
import { useMemo } from 'react'

import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { RANGE_MS, withGaps } from '@/lib/chart'

const GAP_FACTOR = 2

/** Chart-ready series: gaps inserted, x-domain = full range ending at the newest point (or `nowMs`), 5 evenly spaced ticks. */
export const useChartData = (
  points: HistoryPoint[],
  range: HistoryRange,
  nowMs: number,
): { data: HistoryPoint[]; domain: [number, number]; ticks: number[] } =>
  useMemo(() => {
    const end = points.length ? points[points.length - 1]!.t : nowMs
    const start = end - RANGE_MS[range]
    const bucketMs =
      range === '24h'
        ? DEFAULT_SEND_INTERVAL_MS
        : range === '7d'
          ? 3_600_000
          : 6 * 3_600_000
    const data = withGaps(points, bucketMs * GAP_FACTOR)
    const ticks = [0, 1, 2, 3, 4].map((i) => start + (i * RANGE_MS[range]) / 4)
    return { data, domain: [start, end], ticks }
  }, [points, range, nowMs])
