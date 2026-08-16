'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { NAV_ITEMS } from './nav-items'

import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'

interface MobileNavProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceLabel: string | null
}

export const MobileNav = ({
  testId,
  open,
  onOpenChange,
  deviceLabel,
}: MobileNavProps): ReactElement => {
  const pathname = usePathname()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  return (
    <Sheet
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title={deviceLabel ? `Station ${deviceLabel}` : 'Menu'}
    >
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            onClick={close}
            aria-current={pathname === item.href ? 'page' : undefined}
            className={cn(
              'rounded-control px-3 py-2 text-sm font-medium',
              pathname === item.href ? 'bg-paper text-ink' : 'text-slate',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </Sheet>
  )
}
