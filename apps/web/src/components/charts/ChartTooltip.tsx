import type { ReactElement } from 'react'
import type { TooltipPayloadEntry } from 'recharts'

import { formatDateTime } from '@/lib/format'
import { formatNumber } from '@/lib/number-format'
import type { ParameterMeta } from '@/lib/parameters'

interface ChartTooltipProps {
  active?: boolean
  payload?: ReadonlyArray<TooltipPayloadEntry>
  meta: ParameterMeta
  testId: string
}

const pointTime = (raw: unknown): number | null => {
  if (typeof raw === 'object' && raw !== null && 't' in raw) {
    const t = (raw as { t: unknown }).t
    return typeof t === 'number' ? t : null
  }
  return null
}

export const ChartTooltip = ({
  active,
  payload,
  meta,
  testId,
}: ChartTooltipProps): ReactElement | null => {
  const item = payload?.[0]
  const t = pointTime(item?.payload)
  if (!active || !item || typeof item.value !== 'number' || t === null)
    return null
  return (
    <div
      data-testid={testId}
      className="rounded-control border-line bg-card shadow-card border px-2.5 py-1.5"
    >
      <div className="text-slate font-mono text-[11px]">
        {formatDateTime(new Date(t).toISOString())}
      </div>
      <div className="readout text-base">
        {formatNumber(item.value, meta.decimals)}{' '}
        <span className="text-slate text-xs font-medium">{meta.unit}</span>
      </div>
    </div>
  )
}
