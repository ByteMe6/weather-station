'use client'

import type { ReactElement } from 'react'

import { CompassGlyph } from './CompassGlyph'
import { TrendGlyph } from './TrendGlyph'

import { Sparkline } from '@/components/charts/Sparkline'
import { NumberRoll } from '@/components/motion/NumberRoll'
import { Card } from '@/components/ui/Card'
import type { HistoryPoint, Trend } from '@/lib/chart'
import { bearingToCompass } from '@/lib/format'
import type { ParameterMeta } from '@/lib/parameters'
import { cn } from '@/lib/utils'

interface ParameterCardProps {
  meta: ParameterMeta
  value: number | null
  points: HistoryPoint[]
  trend: Trend | null
  testId: string
}

export const ParameterCard = ({
  meta,
  value,
  points,
  trend,
  testId,
}: ParameterCardProps): ReactElement => {
  const fitted = value !== null
  return (
    <Card
      testId={testId}
      accent={meta.accent}
      data-fitted={fitted}
      className={cn('p-4 pb-3', !fitted && 'opacity-55')}
    >
      <div className="text-slate text-[11px] tracking-[0.08em] uppercase">
        {meta.label}
      </div>
      <div className="mt-2 flex items-end gap-1">
        {meta.key === 'windDirection' && fitted ? (
          <div className="flex items-center gap-2">
            <CompassGlyph testId={`${testId}-compass`} bearing={value} />
            <span className="readout text-[32px] leading-none">
              {bearingToCompass(value)}
            </span>
          </div>
        ) : (
          <NumberRoll
            testId={`${testId}-value`}
            value={value}
            decimals={meta.decimals}
            className="text-[32px] leading-none"
          />
        )}
        <span className="text-slate pb-0.5 text-[13px] font-medium">
          {meta.unit}
        </span>
      </div>
      <div className="mt-2">
        <Sparkline
          testId={`${testId}-spark`}
          points={points}
          dataKey={meta.key}
          color={meta.cssVar}
          dashed={!fitted}
        />
      </div>
      <div className="text-slate mt-1.5 flex items-center justify-between text-xs">
        <span>{fitted ? 'last 3 h' : 'Sensor not fitted'}</span>
        {fitted ? (
          <TrendGlyph
            testId={`${testId}-trend`}
            trend={trend}
            decimals={meta.decimals}
          />
        ) : null}
      </div>
    </Card>
  )
}
