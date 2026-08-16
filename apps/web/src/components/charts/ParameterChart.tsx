'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'
import type { TooltipContentProps } from 'recharts'
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartTooltip } from './ChartTooltip'
import { useChartData } from './useChartData'

import { springs } from '@/components/motion/variants'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { formatTime } from '@/lib/format'
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
    (t: number) => formatTime(new Date(t).toISOString()),
    [],
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
    <LineChart
      data={data}
      margin={{ top: 12, right: 12, bottom: 4, left: 0 }}
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
        width={44}
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
    </LineChart>
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
