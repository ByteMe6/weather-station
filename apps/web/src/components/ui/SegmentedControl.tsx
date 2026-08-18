'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: string
}
interface SegmentedControlProps<T extends string> {
  testId: string
  value: T
  onValueChange: (value: T) => void
  options: Option<T>[]
  ariaLabel: string
  /** Unique per instance so indicators don't fly between controls. */
  layoutId: string
}

export const SegmentedControl = <T extends string>({
  testId,
  value,
  onValueChange,
  options,
  ariaLabel,
  layoutId,
}: SegmentedControlProps<T>): ReactElement => {
  const choose = useCallback((v: T) => () => onValueChange(v), [onValueChange])
  return (
    <div
      data-testid={testId}
      role="radiogroup"
      aria-label={ariaLabel}
      className="rounded-control border-line bg-paper inline-flex gap-0.5 border p-[3px]"
    >
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`${testId}-${o.value}`}
            onClick={choose(o.value)}
            className={cn(
              'relative rounded-[7px] px-3 py-1.5 text-[13px] font-medium max-lg:min-w-11 max-lg:py-3',
              selected ? 'text-ink' : 'text-slate hover:text-ink',
            )}
          >
            {selected ? (
              <motion.span
                layoutId={layoutId}
                className="bg-card shadow-card absolute inset-0 rounded-[7px]"
                transition={springs.snappy}
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
