'use client'

import { MotionConfig } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { springs } from './variants'

/** Global motion policy: no-overshoot springs, honour prefers-reduced-motion. */
export const MotionProvider = ({
  children,
}: {
  children: ReactNode
}): ReactElement => (
  <MotionConfig reducedMotion="user" transition={springs.default}>
    {children}
  </MotionConfig>
)
