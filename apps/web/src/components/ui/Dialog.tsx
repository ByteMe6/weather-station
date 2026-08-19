'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface DialogProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}

/**
 * Radix Dialog + Motion presence: `asChild` motion children, `forceMount`
 * inside AnimatePresence, state hoisted by the caller (motion skill rules).
 */
export const Dialog = ({
  testId,
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: DialogProps): ReactElement => (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <AnimatePresence>
      {open ? (
        <RadixDialog.Portal forceMount>
          <RadixDialog.Overlay asChild forceMount>
            <motion.div
              data-testid={`${testId}-overlay`}
              className="bg-ink/40 fixed inset-0 z-40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.snappy}
            />
          </RadixDialog.Overlay>
          <RadixDialog.Content
            asChild
            forceMount
            aria-describedby={description ? undefined : ''}
          >
            <motion.div
              data-testid={testId}
              className={cn(
                'rounded-card border-line bg-card shadow-card fixed top-1/2 left-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 border p-6',
                className,
              )}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={springs.default}
            >
              <div className="mb-4 flex items-start gap-3">
                <div className="flex-1">
                  <RadixDialog.Title className="text-lg font-semibold tracking-tight">
                    {title}
                  </RadixDialog.Title>
                  {description ? (
                    <RadixDialog.Description className="text-slate mt-1 text-sm">
                      {description}
                    </RadixDialog.Description>
                  ) : null}
                </div>
                {/* Dismissing is the one thing every dialog must offer, and
                    on a phone the X is how it is done — 24px was not a thumb
                    target. Flex-centred because Preflight's `svg { display:
                    block }` ignores text-align, so the icon would otherwise
                    sit at the start of a box now wider than it. Matches the
                    drawer's close button. */}
                <RadixDialog.Close
                  data-testid={`${testId}-close`}
                  aria-label="Close"
                  className="rounded-control text-slate hover:bg-paper inline-flex shrink-0 items-center justify-center p-1 max-lg:size-11"
                >
                  <X className="size-4" aria-hidden />
                </RadixDialog.Close>
              </div>
              <div data-testid={`${testId}-content`}>{children}</div>
            </motion.div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      ) : null}
    </AnimatePresence>
  </RadixDialog.Root>
)
