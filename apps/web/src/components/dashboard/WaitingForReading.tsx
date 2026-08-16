'use client'

import type { ReactElement } from 'react'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { EmptyState } from '@/components/ui/EmptyState'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'

export const WaitingForReading = ({
  deviceId,
  status,
  testId,
}: {
  deviceId: string
  status: RealtimeStatus
  testId: string
}): ReactElement => (
  <EmptyState
    testId={testId}
    icon={
      <FreshnessPulse
        testId={`${testId}-pulse`}
        status={status === 'live' ? 'live' : 'reconnecting'}
      />
    }
    title="Waiting for the first reading"
    description={`${deviceId} is registered. Your station posts every 5 minutes — the first reading will appear here the moment it arrives.`}
  />
)
