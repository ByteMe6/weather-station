import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

export const DeviceChip = ({
  label,
  loading = false,
  testId,
}: {
  label: string | null
  /** True while the devices query is pending — never flash "No station". */
  loading?: boolean
  testId: string
}): ReactElement => (
  <span
    data-testid={testId}
    className="text-slate hidden items-center gap-2 font-mono text-xs md:inline-flex"
  >
    {loading ? (
      <Skeleton testId={`${testId}-skeleton`} className="h-3 w-28" />
    ) : label ? (
      <>
        <span>Station</span>
        <b className="text-ink font-medium">{label}</b>
      </>
    ) : (
      <span>No station</span>
    )}
  </span>
)
