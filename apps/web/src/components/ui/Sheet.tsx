'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface SheetProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  side?: 'right' | 'left'
  children: ReactNode
}

export const Sheet = ({
  testId,
  open,
  onOpenChange,
  title,
  side = 'right',
  children,
}: SheetProps): ReactElement => {
  const offset = side === 'right' ? 24 : -24
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="bg-ink/40 fixed inset-0 z-40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={springs.snappy}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.div
                data-testid={testId}
                className={cn(
                  'border-line bg-card shadow-card fixed inset-y-0 z-50 w-[min(88vw,360px)] p-5',
                  side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
                )}
                initial={{ x: offset, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: offset, opacity: 0 }}
                transition={springs.default}
              >
                <div className="mb-4 flex items-center justify-between">
                  <RadixDialog.Title className="text-base font-semibold">
                    {title}
                  </RadixDialog.Title>
                  <RadixDialog.Close
                    data-testid={`${testId}-close`}
                    aria-label="Close"
                    className="rounded-control text-slate hover:bg-paper p-1"
                  >
                    <X className="size-4" aria-hidden />
                  </RadixDialog.Close>
                </div>
                {children}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}
