import { Radio } from 'lucide-react'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { EmptyState } from '@/components/ui/EmptyState'

export const NoDeviceState = ({ testId }: { testId: string }): ReactElement => (
  <EmptyState
    testId={testId}
    icon={<Radio className="size-8" aria-hidden />}
    title="No station yet"
    description="Register the station from the ID printed on its label and readings will start arriving here."
    action={
      <Link
        data-testid={`${testId}-register`}
        href="/devices/register"
        className="rounded-control bg-ink text-paper inline-flex h-10 items-center px-4 text-sm font-semibold"
      >
        Register a device
      </Link>
    }
  />
)
