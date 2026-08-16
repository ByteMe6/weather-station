'use client'

import { Switch as RadixSwitch } from 'radix-ui'
import type { ReactElement } from 'react'

export const Switch = ({
  testId,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  testId: string
  checked: boolean
  onCheckedChange: (c: boolean) => void
  ariaLabel: string
}): ReactElement => (
  <RadixSwitch.Root
    data-testid={testId}
    checked={checked}
    onCheckedChange={onCheckedChange}
    aria-label={ariaLabel}
    className="bg-line data-[state=checked]:bg-sky relative h-6 w-10 rounded-full transition-colors"
  >
    <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
  </RadixSwitch.Root>
)
