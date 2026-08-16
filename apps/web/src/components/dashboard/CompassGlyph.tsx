'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'

import { springs } from '@/components/motion/variants'

/** Needle rotated to the bearing (0° = N, clockwise). */
export const CompassGlyph = ({
  bearing,
  testId,
}: {
  bearing: number
  testId: string
}): ReactElement => (
  <svg data-testid={testId} viewBox="0 0 40 40" className="size-10" aria-hidden>
    <circle
      cx="20"
      cy="20"
      r="17"
      fill="none"
      stroke="var(--color-line)"
      strokeWidth="1.5"
    />
    <motion.g
      style={{ originX: '20px', originY: '20px' }}
      animate={{ rotate: bearing }}
      transition={springs.default}
    >
      <path d="M20 5 L24 20 L20 17 L16 20 Z" fill="var(--color-wind)" />
      <path d="M20 35 L24 20 L20 23 L16 20 Z" fill="var(--color-line)" />
    </motion.g>
  </svg>
)
