import type { Transition, Variants } from 'motion/react'

/** Data-tool springs: no overshoot, ever. */
export const springs = {
  default: { type: 'spring', bounce: 0, visualDuration: 0.35 },
  snappy: { type: 'spring', bounce: 0, visualDuration: 0.2 },
} as const satisfies Record<string, Transition>

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springs.default },
}

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
}

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: springs.snappy },
  exit: { opacity: 0, transition: springs.snappy },
}
