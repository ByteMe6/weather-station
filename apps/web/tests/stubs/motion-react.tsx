/* Test stub for `motion/react`: renders plain elements, no animation. */
import type { ReactElement, ReactNode } from 'react'
import { createElement, forwardRef } from 'react'

const MOTION_PROPS = new Set([
  'initial',
  'animate',
  'exit',
  'variants',
  'transition',
  'whileHover',
  'whileTap',
  'whileInView',
  'viewport',
  'layout',
  'layoutId',
])

const isMotionValue = (v: unknown): v is { get: () => unknown } =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { get?: unknown }).get === 'function'

const stripMotionProps = (props: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (!MOTION_PROPS.has(key)) out[key] = props[key]
  }
  // Real Motion renders a MotionValue child by reading it.
  if (isMotionValue(out.children)) out.children = out.children.get()
  return out
}

const make = (tag: string) => {
  const Component = forwardRef<HTMLElement, Record<string, unknown>>(
    (props, ref) => createElement(tag, { ...stripMotionProps(props), ref }),
  )
  Component.displayName = `motion.${tag}`
  return Component
}

const cache = new Map<string, ReturnType<typeof make>>()

export const motion: Record<string, ReturnType<typeof make>> = new Proxy(
  {},
  {
    get: (_target, tag: string) => {
      const existing = cache.get(tag)
      if (existing) return existing
      const created = make(tag)
      cache.set(tag, created)
      return created
    },
  },
)

export const AnimatePresence = ({
  children,
}: {
  children?: ReactNode
}): ReactElement => <>{children}</>
export const MotionConfig = ({
  children,
}: {
  children?: ReactNode
}): ReactElement => <>{children}</>
export const LayoutGroup = ({
  children,
}: {
  children?: ReactNode
}): ReactElement => <>{children}</>

export const reducedMotionState = { value: false }
export const useReducedMotion = (): boolean => reducedMotionState.value

interface StubMotionValue<T> {
  get: () => T
  set: (v: T) => void
  jump: (v: T) => void
  on: () => () => void
}
const mv = <T,>(v: T): StubMotionValue<T> => {
  let current = v
  return {
    get: () => current,
    set: (n) => {
      current = n
    },
    jump: (n) => {
      current = n
    },
    on: () => () => undefined,
  }
}
export const useMotionValue = <T,>(v: T): StubMotionValue<T> => mv(v)
export const useSpring = <T,>(v: T): StubMotionValue<T> => mv(v)
export const useTransform = <T,>(fn: () => T): StubMotionValue<T> => mv(fn())
export const animate = (): { stop: () => void } => ({ stop: () => undefined })
