'use client'

import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import type { ReactElement } from 'react'
import { useEffect } from 'react'

import { formatNumber } from '@/lib/number-format'
import { cn } from '@/lib/utils'

interface NumberRollProps {
  value: number | null
  decimals: number
  testId: string
  className?: string
}

/**
 * Animates numeric changes with a no-bounce spring; snaps under reduced
 * motion. Renders the MotionValue directly (never reads it during render).
 */
export const NumberRoll = ({
  value,
  decimals,
  testId,
  className,
}: NumberRollProps): ReactElement => {
  const reduced = useReducedMotion()
  const spring = useSpring(value ?? 0, { bounce: 0, visualDuration: 0.5 })
  const text = useTransform(() => formatNumber(spring.get(), decimals))

  useEffect(() => {
    if (value === null) return
    if (reduced) spring.jump(value)
    else spring.set(value)
  }, [value, reduced, spring])

  if (value === null) {
    return (
      <span data-testid={testId} className={cn('readout', className)}>
        —
      </span>
    )
  }
  return (
    <motion.span data-testid={testId} className={cn('readout', className)}>
      {text}
    </motion.span>
  )
}
