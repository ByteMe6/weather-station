'use client'

import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { WEEKDAYS } from '@/lib/schedule'
import { cn } from '@/lib/utils'

export const DayPicker = ({
  value,
  onChange,
  testId,
}: {
  value: number[]
  onChange: (days: number[]) => void
  testId: string
}): ReactElement => {
  const toggle = useCallback(
    (day: number) => () =>
      onChange(
        value.includes(day)
          ? value.filter((d) => d !== day)
          : [...value, day].sort((a, b) => a - b),
      ),
    [value, onChange],
  )
  return (
    <div
      data-testid={testId}
      role="group"
      aria-label="Days"
      className="flex flex-wrap gap-1.5"
    >
      {WEEKDAYS.map((d) => {
        const on = value.includes(d.value)
        return (
          <button
            key={d.value}
            type="button"
            aria-pressed={on}
            data-testid={`${testId}-${d.value}`}
            onClick={toggle(d.value)}
            className={cn(
              // `min-w-11` already met the 44px floor; the 36px height did not,
              // and seven small squares side by side is exactly where a thumb
              // hits the wrong one. Grows below lg like the other controls.
              'rounded-control h-9 min-w-11 border px-2 text-[13px] font-medium max-lg:h-11',
              on
                ? 'border-ink bg-ink text-paper'
                : 'border-line text-slate hover:text-ink',
            )}
          >
            {d.short}
          </button>
        )
      })}
    </div>
  )
}
