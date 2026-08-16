import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

const CARDS = [0, 1, 2, 3, 4, 5]

export const DashboardSkeleton = ({
  testId,
}: {
  testId: string
}): ReactElement => (
  <div data-testid={testId} className="flex flex-col gap-6">
    <div className="border-line border-b pb-7">
      <Skeleton testId={`${testId}-eyebrow`} className="mb-3 h-3 w-44" />
      <Skeleton testId={`${testId}-hero`} className="h-24 w-72" />
    </div>
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
      {CARDS.map((i) => (
        <Skeleton
          key={i}
          testId={`${testId}-card-${i}`}
          className="h-[132px]"
        />
      ))}
    </div>
    <Skeleton testId={`${testId}-chart`} className="h-64" />
  </div>
)
