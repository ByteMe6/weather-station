import type { InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  testId: string
  invalid?: boolean
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ testId, invalid = false, mono = false, className, ...rest }, ref) => (
    <input
      ref={ref}
      data-testid={testId}
      aria-invalid={invalid || undefined}
      className={cn(
        'rounded-control bg-card text-ink placeholder:text-slate/70 h-10 w-full border px-3 text-sm',
        invalid ? 'border-danger' : 'border-line',
        mono ? 'font-mono tracking-wide lowercase' : null,
        className,
      )}
      {...rest}
    />
  ),
)
Input.displayName = 'Input'
