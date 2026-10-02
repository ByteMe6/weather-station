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
  id?: string
  value: T | undefined
  onValueChange: (v: T) => void
  options: Option<T>[]
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
}

export const Select = <T extends string>({
  testId,
  id,
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
      id={id}
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
        // Bounded to the room the popper actually has, so a long menu scrolls
        // inside itself instead of running off the bottom of the screen. Twelve
        // 44px timezone rows reach 955px in an 844px viewport otherwise, and
        // the last options cannot be picked at all.
        className="rounded-control border-line bg-card shadow-card z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] border p-1"
      >
        <RadixSelect.Viewport>
          {options.map((o) => (
            <RadixSelect.Item
              key={o.value}
              value={o.value}
              data-testid={`${testId}-option-${o.value}`}
              // A dropdown row is picked with a thumb like any other control,
              // so it grows to the 44px floor below lg. `min-h` rather than a
              // fixed height so a long label that wraps is not clipped.
              className="data-[highlighted]:bg-paper flex cursor-pointer items-center justify-between rounded-[7px] px-2 py-1.5 text-sm outline-none max-lg:min-h-11"
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
