/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react'

import { useChartData } from '@/components/charts/useChartData'
import type { HistoryPoint } from '@/lib/chart'

const p = (iso: string, temperature: number): HistoryPoint => ({
  t: new Date(iso).getTime(),
  temperature,
  humidity: null,
  pressure: null,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})

describe('useChartData', () => {
  it('adds gap points and produces a domain covering the range with 5 ticks', () => {
    const points = [
      p('2026-08-15T10:00:00Z', 20),
      p('2026-08-15T10:05:00Z', 21),
      p('2026-08-15T11:00:00Z', 22),
    ]
    const { result } = renderHook(() =>
      useChartData(points, '24h', new Date('2026-08-15T12:00:00Z').getTime()),
    )
    expect(result.current.data).toHaveLength(4)
    expect(result.current.ticks).toHaveLength(5)
    expect(result.current.domain[1] - result.current.domain[0]).toBe(
      24 * 3_600_000,
    )
  })
})
