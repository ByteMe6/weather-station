'use client'

import { motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { fadeUp } from './variants'

export const Reveal = ({
  children,
  testId,
  className,
  delay = 0,
}: {
  children: ReactNode
  testId: string
  className?: string
  delay?: number
}): ReactElement => (
  <motion.div
    data-testid={testId}
    className={className}
    variants={fadeUp}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: '-40px' }}
    transition={{ delay }}
  >
    {children}
  </motion.div>
)
