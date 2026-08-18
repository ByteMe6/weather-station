'use client'

import { useTheme } from 'next-themes'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export const AppearanceCard = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  const { theme, setTheme } = useTheme()
  const choose = useCallback(
    (value: string) => () => setTheme(value),
    [setTheme],
  )
  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>Appearance</CardTitle>
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <p className="text-slate mb-3 text-sm">
          Follows your system by default.
        </p>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="rounded-control border-line bg-paper inline-flex border p-1"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={theme === o.value}
              data-testid={`${testId}-${o.value}`}
              onClick={choose(o.value)}
              className={cn(
                'rounded-[7px] px-3 py-1.5 text-[13px] font-medium max-lg:min-w-11 max-lg:py-3',
                theme === o.value
                  ? 'bg-card text-ink shadow-card'
                  : 'text-slate',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
