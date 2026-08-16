import type { ReactElement } from 'react'

import type { Trend } from '@/lib/chart'
import { formatNumber } from '@/lib/number-format'
import { cn } from '@/lib/utils'

const GLYPH = { up: '▴', down: '▾', flat: '—' } as const

export const TrendGlyph = ({
  trend,
  decimals,
  unit,
  testId,
}: {
  trend: Trend | null
  decimals: number
  unit?: string
  testId: string
}): ReactElement => {
  if (!trend) {
    return (
      <span data-testid={testId} className="text-slate text-xs">
        —
      </span>
    )
  }
  return (
    <span
      data-testid={testId}
      data-direction={trend.direction}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        trend.direction === 'up'
          ? 'text-temp'
          : trend.direction === 'down'
            ? 'text-rain'
            : 'text-slate',
      )}
    >
      {GLYPH[trend.direction]} {formatNumber(Math.abs(trend.delta), decimals)}
      {unit ? ` ${unit}` : ''}
    </span>
  )
}
