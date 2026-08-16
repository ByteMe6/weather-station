import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

const CARDS = [0, 1, 2, 3, 4]

export const ShellSkeleton = ({ testId }: { testId: string }): ReactElement => (
  <div data-testid={testId} className="mx-auto max-w-[1180px] px-6 py-8">
    <Skeleton testId={`${testId}-eyebrow`} className="mb-3 h-3 w-40" />
    <Skeleton testId={`${testId}-hero`} className="mb-8 h-24 w-64" />
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
      {CARDS.map((i) => (
        <Skeleton
          key={i}
          testId={`${testId}-card-${i}`}
          className="h-[132px]"
        />
      ))}
    </div>
  </div>
)
