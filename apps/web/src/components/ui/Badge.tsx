import type { ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'live' | 'danger' | 'muted'

const TONE: Record<BadgeTone, string> = {
  neutral: 'border-line text-slate',
  live: 'border-sky/30 text-sky',
  danger: 'border-danger/40 text-danger',
  muted: 'border-line text-slate opacity-60',
}

export const Badge = ({
  testId,
  tone = 'neutral',
  children,
}: {
  testId: string
  tone?: BadgeTone
  children: ReactNode
}): ReactElement => (
  <span
    data-testid={testId}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]',
      TONE[tone],
    )}
  >
    {tone === 'live' ? (
      <span
        data-testid={`${testId}-dot`}
        className="bg-sky size-1.5 rounded-full"
        aria-hidden
      />
    ) : null}
    {children}
  </span>
)
