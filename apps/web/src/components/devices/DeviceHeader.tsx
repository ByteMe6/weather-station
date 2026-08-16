import type { DeviceRole } from '@ws/shared'
import type { ReactElement } from 'react'

import { Badge } from '@/components/ui/Badge'

export const DeviceHeader = ({
  deviceId,
  status,
  role,
  testId,
}: {
  deviceId: string
  status: string | null
  role: DeviceRole
  testId: string
}): ReactElement => (
  <div data-testid={testId} className="flex flex-wrap items-center gap-3">
    <h1 className="font-mono text-xl font-semibold tracking-tight">
      {deviceId}
    </h1>
    <Badge
      testId={`${testId}-status`}
      tone={status === 'registered' ? 'live' : 'muted'}
    >
      {status ?? 'unknown'}
    </Badge>
    <Badge testId={`${testId}-role`}>you: {role}</Badge>
  </div>
)
