'use client'

import { Check, ChevronDown } from 'lucide-react'
import { Select as RadixSelect } from 'radix-ui'
import type { ReactElement } from 'react'

interface Option<T extends string> {
  value: T
  label: string
}
interface SelectProps<T extends string> {
  testId: string
  value: T | undefined
  onValueChange: (v: T) => void
  options: Option<T>[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
}

export const Select = <T extends string>({
  testId,
  value,
  onValueChange,
  options,
  ariaLabel,
  placeholder,
  disabled,
}: SelectProps<T>): ReactElement => (
  <RadixSelect.Root
    value={value}
    onValueChange={onValueChange}
    disabled={disabled}
  >
    <RadixSelect.Trigger
      data-testid={testId}
      aria-label={ariaLabel}
      className="rounded-control border-line bg-card inline-flex h-9 min-w-32 items-center justify-between gap-2 border px-3 text-sm disabled:opacity-60 max-lg:h-11"
    >
      <RadixSelect.Value placeholder={placeholder} />
      <RadixSelect.Icon>
        <ChevronDown className="text-slate size-4" aria-hidden />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
    <RadixSelect.Portal>
      <RadixSelect.Content
        position="popper"
        sideOffset={4}
        className="rounded-control border-line bg-card shadow-card z-50 min-w-[var(--radix-select-trigger-width)] border p-1"
      >
        <RadixSelect.Viewport>
          {options.map((o) => (
            <RadixSelect.Item
              key={o.value}
              value={o.value}
              data-testid={`${testId}-option-${o.value}`}
              className="data-[highlighted]:bg-paper flex cursor-pointer items-center justify-between rounded-[7px] px-2 py-1.5 text-sm outline-none"
            >
              <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
              <RadixSelect.ItemIndicator>
                <Check className="size-3.5" aria-hidden />
              </RadixSelect.ItemIndicator>
            </RadixSelect.Item>
          ))}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  </RadixSelect.Root>
)
