import type { DeviceRole } from '@ws/shared'
import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'

import { Badge } from '@/components/ui/Badge'

export const DeviceHeader = ({
  deviceId,
  label,
  address,
  status,
  role,
  action,
  testId,
}: {
  deviceId: string
  label: string | null
  address: string | null
  status: string | null
  role: DeviceRole
  /** "Edit details" control (owners and editors), rendered to the right. */
  action?: ReactNode
  testId: string
}): ReactElement => (
  <div data-testid={testId} className="flex flex-wrap items-start gap-3">
    <div className="flex flex-col gap-1">
      <Link
        data-testid={`${testId}-back`}
        href="/devices"
        className="text-slate hover:text-ink w-fit text-[13px] underline-offset-2 hover:underline"
      >
        ← All stations
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {label ?? deviceId}
        </h1>
        <Badge
          testId={`${testId}-status`}
          tone={status === 'registered' ? 'live' : 'muted'}
        >
          {status ?? 'unknown'}
        </Badge>
        <Badge testId={`${testId}-role`}>you: {role}</Badge>
      </div>
      <p className="text-slate font-mono text-xs">
        {deviceId}
        {address ? <span className="font-sans"> · {address}</span> : null}
      </p>
    </div>
    <span className="flex-1" />
    {action ?? null}
  </div>
)
