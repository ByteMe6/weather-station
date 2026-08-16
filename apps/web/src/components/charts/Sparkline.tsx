'use client'

import type { ReactElement } from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'

import type { HistoryPoint } from '@/lib/chart'
import type { ParameterKey } from '@/lib/parameters'

interface SparklineProps {
  points: HistoryPoint[]
  dataKey: ParameterKey
  color: string
  testId: string
  dashed?: boolean
}

export const Sparkline = ({
  points,
  dataKey,
  color,
  testId,
  dashed = false,
}: SparklineProps): ReactElement => (
  <div data-testid={testId} className="h-7 w-full" aria-hidden>
    <ResponsiveContainer
      width="100%"
      height="100%"
      initialDimension={{ width: 200, height: 28 }}
    >
      <LineChart
        data={points}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
          connectNulls={false}
          strokeDasharray={dashed ? '2 3' : undefined}
        />
      </LineChart>
    </ResponsiveContainer>
  </div>
)
