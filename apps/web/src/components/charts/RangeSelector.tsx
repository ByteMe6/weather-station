'use client'

import type { ReactElement } from 'react'

import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { HistoryRange } from '@/lib/chart'

const OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 d' },
  { value: '30d', label: '30 d' },
]

export const RangeSelector = ({
  testId,
  value,
  onChange,
}: {
  testId: string
  value: HistoryRange
  onChange: (r: HistoryRange) => void
}): ReactElement => (
  <SegmentedControl
    testId={testId}
    ariaLabel="Chart range"
    layoutId="range-selector"
    value={value}
    onValueChange={onChange}
    options={OPTIONS}
  />
)
