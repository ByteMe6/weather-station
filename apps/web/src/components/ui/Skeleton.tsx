import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

export const Skeleton = ({
  testId,
  className,
}: {
  testId: string
  className?: string
}): ReactElement => (
  <div
    data-testid={testId}
    aria-hidden="true"
    className={cn('rounded-control bg-line/70 animate-pulse', className)}
  />
)
