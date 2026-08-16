import type { ReactElement } from 'react'

import { WEEKDAYS } from '@/lib/schedule'
import { cn } from '@/lib/utils'

/** Read-only weekday pills for a schedule row. */
export const DayPills = ({
  days,
  testId,
}: {
  days: number[]
  testId: string
}): ReactElement => (
  <div data-testid={testId} className="flex gap-1">
    {WEEKDAYS.map((d) => {
      const on = days.includes(d.value)
      return (
        <span
          key={d.value}
          data-testid={`${testId}-${d.value}`}
          data-on={on}
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px] font-medium',
            on ? 'bg-ink text-paper' : 'text-slate/50',
          )}
        >
          {d.short.slice(0, 2)}
        </span>
      )
    })}
  </div>
)
