'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

export type FreshnessStatus = 'live' | 'stale' | 'reconnecting' | 'offline'

interface FreshnessPulseProps {
  status: FreshnessStatus
  /** Change this value to trigger one expanded pulse (e.g. reading id). */
  pulseKey?: number
  testId: string
}

const COLOR: Record<FreshnessStatus, string> = {
  live: 'bg-sky',
  stale: 'bg-slate',
  reconnecting: 'bg-wind',
  offline: 'bg-slate',
}

export const FreshnessPulse = ({
  status,
  pulseKey = 0,
  testId,
}: FreshnessPulseProps): ReactElement => {
  const reduced = useReducedMotion()
  return (
    <span
      data-testid={testId}
      data-status={status}
      className="relative inline-flex size-2"
      aria-hidden
    >
      <span className={cn('absolute inset-0 rounded-full', COLOR[status])} />
      {status === 'live' && !reduced ? (
        <motion.span
          key={pulseKey}
          className="bg-sky absolute inset-0 rounded-full"
          initial={{ scale: 1, opacity: 0.45 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{
            duration: 1.2,
            ease: 'easeOut',
            repeat: Infinity,
            repeatDelay: 1.6,
          }}
        />
      ) : null}
    </span>
  )
}
