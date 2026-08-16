import type { ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  testId: string
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export const EmptyState = ({
  testId,
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps): ReactElement => (
  <div
    data-testid={testId}
    className={cn(
      'rounded-card border-line flex flex-col items-center border border-dashed px-6 py-14 text-center',
      className,
    )}
  >
    {icon ? <div className="text-slate mb-4">{icon}</div> : null}
    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
    {description ? (
      <p className="text-slate mt-1 max-w-sm text-sm">{description}</p>
    ) : null}
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
)
