'use client'

import type { ReactElement, ReactNode } from 'react'
import { useMemo } from 'react'

import { ParameterChart } from './ParameterChart'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { formatNumber } from '@/lib/number-format'
import type { ParameterMeta } from '@/lib/parameters'

export const ChartPanel = ({
  meta,
  points,
  range,
  now,
  testId,
  aside,
}: {
  meta: ParameterMeta
  points: HistoryPoint[]
  range: HistoryRange
  now: Date
  testId: string
  /** Extra header content (e.g. the wind-direction glyph on the wind panel). */
  aside?: ReactNode
}): ReactElement => {
  const stats = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      const v = p[meta.key]
      if (v === null) continue
      if (v < min) min = v
      if (v > max) max = v
    }
    return Number.isFinite(min) ? { min, max } : null
  }, [points, meta.key])
  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>{meta.label}</CardTitle>
        <span className="text-slate inline-flex items-center gap-1.5 text-xs">
          <i
            className="inline-block h-[3px] w-2.5 rounded"
            style={{ background: meta.cssVar }}
          />
          {meta.unit}
          {range === '7d'
            ? ' · hourly avg'
            : range === '30d'
              ? ' · 6-hour avg'
              : ''}
        </span>
        {stats ? (
          <span className="text-slate font-mono text-xs">
            min {formatNumber(stats.min, meta.decimals)} · max{' '}
            {formatNumber(stats.max, meta.decimals)}
          </span>
        ) : null}
        <span className="flex-1" />
        {aside ?? null}
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <ParameterChart
          testId={`${testId}-chart`}
          meta={meta}
          points={points}
          range={range}
          now={now}
        />
      </CardBody>
    </Card>
  )
}
