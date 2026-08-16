'use client'

import { motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'

/** Fade-in per route change; no exit animations across routes (spec §1.3). */
const AppTemplate = ({ children }: { children: ReactNode }): ReactElement => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={springs.default}
  >
    {children}
  </motion.div>
)

export default AppTemplate
