import type { HTMLAttributes, ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type CardAccent = 'temp' | 'hum' | 'press' | 'wind' | 'rain'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  testId: string
  accent?: CardAccent
  children: ReactNode
}

const ACCENT: Record<CardAccent, string> = {
  temp: 'before:bg-temp',
  hum: 'before:bg-hum',
  press: 'before:bg-press',
  wind: 'before:bg-wind',
  rain: 'before:bg-rain',
}

export const Card = ({
  testId,
  accent,
  className,
  children,
  ...rest
}: CardProps): ReactElement => (
  <div
    data-testid={testId}
    data-accent={accent}
    className={cn(
      'rounded-card border-line bg-card shadow-card relative overflow-hidden border',
      accent
        ? `before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${ACCENT[accent]}`
        : null,
      className,
    )}
    {...rest}
  >
    {children}
  </div>
)

export const CardHeader = ({
  testId,
  className,
  children,
}: {
  testId: string
  className?: string
  children: ReactNode
}): ReactElement => (
  <div
    data-testid={testId}
    className={cn('flex items-center gap-3 px-5 pt-4', className)}
  >
    {children}
  </div>
)

export const CardTitle = ({
  testId,
  children,
}: {
  testId: string
  children: ReactNode
}): ReactElement => (
  <h2 data-testid={testId} className="text-[15px] font-semibold tracking-tight">
    {children}
  </h2>
)

export const CardBody = ({
  testId,
  className,
  children,
}: {
  testId: string
  className?: string
  children: ReactNode
}): ReactElement => (
  <div data-testid={testId} className={cn('px-5 pb-4', className)}>
    {children}
  </div>
)
