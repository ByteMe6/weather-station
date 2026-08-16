import type { ReactElement } from 'react'

export const DeviceChip = ({
  label,
  testId,
}: {
  label: string | null
  testId: string
}): ReactElement => (
  <span
    data-testid={testId}
    className="text-slate hidden items-center gap-2 font-mono text-xs md:inline-flex"
  >
    {label ? (
      <>
        <span>Station</span>
        <b className="text-ink font-medium">{label}</b>
      </>
    ) : (
      <span>No station</span>
    )}
  </span>
)
