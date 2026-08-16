'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'
import type { TooltipContentProps } from 'recharts'
import {
  Area,
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltip } from './ChartTooltip'
import { useChartData } from './useChartData'

import { springs } from '@/components/motion/variants'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { formatDay, formatTime } from '@/lib/format'
import type { ParameterMeta } from '@/lib/parameters'

interface ParameterChartProps {
  meta: ParameterMeta
  points: HistoryPoint[]
  range: HistoryRange
  /** Clock for the x-domain when there are no points (keeps render pure). */
  now: Date
  testId: string
  height?: number
  /** Fixed width (tests / SSR); omit to fill the container. */
  width?: number
}

interface DotProps {
  cx?: number
  cy?: number
  index?: number
  value?: number | null
}

const BANDED_KEYS = new Set(['temperature', 'humidity', 'pressure'])
const AXIS_TICK = {
  fontSize: 11,
  fill: 'var(--color-slate)',
  fontFamily: 'var(--font-mono)',
}

export const ParameterChart = ({
  meta,
  points,
  range,
  now,
  testId,
  height = 220,
  width,
}: ParameterChartProps): ReactElement => {
  const { data, domain, ticks } = useChartData(points, range, now.getTime())
  const lastIndex = data.length - 1
  // Bucketed ranges carry min/max bands (spec §4.2); raw 24h rows do not.
  const banded = range !== '24h' && BANDED_KEYS.has(meta.key)
  const lastT = points[points.length - 1]?.t ?? 0

  // Only the newest point gets a dot — and it animates in ("the reading arrives").
  const renderDot = useCallback(
    (props: DotProps): ReactElement => {
      if (
        props.index !== lastIndex ||
        props.cx === undefined ||
        props.cy === undefined ||
        props.value === null ||
        props.value === undefined
      ) {
        return <g key={`dot-${props.index ?? 'x'}`} />
      }
      const origin = { transformOrigin: `${props.cx}px ${props.cy}px` }
      return (
        <g key={`dot-${props.index}-${lastT}`}>
          <motion.circle
            cx={props.cx}
            cy={props.cy}
            r={9}
            fill={meta.cssVar}
            opacity={0.18}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.default}
            style={origin}
          />
          <motion.circle
            cx={props.cx}
            cy={props.cy}
            r={4}
            fill={meta.cssVar}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={springs.default}
            style={origin}
          />
        </g>
      )
    },
    [lastIndex, lastT, meta.cssVar],
  )

  const tickFormatter = useCallback(
    (t: number) =>
      range === '24h'
        ? formatTime(new Date(t).toISOString())
        : formatDay(new Date(t).toISOString()),
    [range],
  )
  const tooltip = useCallback(
    (p: TooltipContentProps) => (
      <ChartTooltip
        active={p.active}
        payload={p.payload}
        meta={meta}
        testId={`${testId}-tooltip`}
      />
    ),
    [meta, testId],
  )

  const chart = (
    <ComposedChart
      data={data}
      margin={{ top: 12, right: 28, bottom: 4, left: 0 }}
      width={width}
      height={width ? height : undefined}
    >
      <XAxis
        dataKey="t"
        type="number"
        scale="time"
        domain={domain}
        ticks={ticks}
        tickFormatter={tickFormatter}
        tick={AXIS_TICK}
        axisLine={{ stroke: 'var(--color-line)' }}
        tickLine={false}
        minTickGap={24}
      />
      <YAxis
        width={52}
        domain={['auto', 'auto']}
        tick={AXIS_TICK}
        axisLine={false}
        tickLine={false}
        tickCount={4}
      />
      <Tooltip
        content={tooltip}
        cursor={{ stroke: 'var(--color-line)' }}
        isAnimationActive={false}
      />
      {banded ? (
        <>
          <Area
            type="monotone"
            dataKey={`${meta.key}Max`}
            stroke="none"
            fill={meta.cssVar}
            fillOpacity={0.12}
            isAnimationActive={false}
            connectNulls={false}
            activeDot={false}
          />
          <Area
            type="monotone"
            dataKey={`${meta.key}Min`}
            stroke="none"
            fill="var(--color-card)"
            fillOpacity={1}
            isAnimationActive={false}
            connectNulls={false}
            activeDot={false}
          />
        </>
      ) : null}
      {meta.key === 'precipitation' ? (
        // Rain is an accumulation per interval — bars are the honest mark.
        <Bar
          dataKey="precipitation"
          fill={meta.cssVar}
          radius={[2, 2, 0, 0]}
          isAnimationActive={false}
          maxBarSize={10}
        />
      ) : (
        <Line
          type="monotone"
          dataKey={meta.key}
          stroke={meta.cssVar}
          strokeWidth={2}
          dot={renderDot}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
          connectNulls={false}
        />
      )}
    </ComposedChart>
  )

  return (
    <div data-testid={testId} style={{ height }} className="w-full">
      {width ? (
        chart
      ) : (
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 600, height }}
        >
          {chart}
        </ResponsiveContainer>
      )}
    </div>
  )
}
