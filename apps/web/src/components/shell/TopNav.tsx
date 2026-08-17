'use client'

import { UserButton } from '@clerk/nextjs'
import { Menu, ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { DeviceChip } from './DeviceChip'
import { MobileNav } from './MobileNav'
import { NAV_ITEMS } from './nav-items'
import { OrgSwitcher } from './OrgSwitcher'
import { ThemeToggle } from './ThemeToggle'

import { Logo } from '@/components/brand/Logo'
import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'
import type { MyDevice } from '@/services/devices/devices.service'

export const TopNav = ({
  testId,
  devices,
  selectedDeviceId,
  onSelectDevice,
  deviceLabel,
  devicesLoading = false,
  showAdmin = false,
}: {
  testId: string
  devices: MyDevice[]
  selectedDeviceId: string | null
  onSelectDevice: (deviceId: string) => void
  /** Name of the active station, for the mobile drawer title. */
  deviceLabel: string | null
  devicesLoading?: boolean
  /** The admin link is cosmetic — the proxy, layout and actions are the gates. */
  showAdmin?: boolean
}): ReactElement => {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = useCallback(() => setMenuOpen(true), [])

  return (
    <header
      data-testid={testId}
      className="border-line bg-paper/90 sticky top-0 z-30 border-b backdrop-blur"
    >
      <div className="mx-auto flex h-[60px] max-w-[1180px] items-center gap-6 px-6">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 font-bold tracking-tight"
        >
          <Logo testId={`${testId}-logo`} size={22} />
          Weather Station
        </Link>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1.5 md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={`${testId}-link-${item.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-control relative px-3 py-2 text-sm font-medium',
                  active ? 'text-ink' : 'text-slate hover:text-ink',
                )}
              >
                {item.label}
                {active ? (
                  <motion.span
                    layoutId="nav-indicator"
                    className="bg-sky absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full"
                    transition={springs.snappy}
                  />
                ) : null}
              </Link>
            )
          })}
        </nav>
        <span className="flex-1" />
        <DeviceChip
          testId={`${testId}-device`}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={onSelectDevice}
          loading={devicesLoading}
        />
        <OrgSwitcher testId={`${testId}-org`} />
        <ThemeToggle testId={`${testId}-theme`} />
        {/* The console lives in the account menu, not the main nav: it is for
            the few people who run the fleet, not part of everyday navigation.
            Hiding it is cosmetic — the proxy, layout and actions are the gates. */}
        <UserButton>
          {showAdmin ? (
            <UserButton.MenuItems>
              <UserButton.Link
                href="/admin"
                label="Admin console"
                labelIcon={<ShieldCheck className="size-4" aria-hidden />}
              />
            </UserButton.MenuItems>
          ) : null}
        </UserButton>
        <button
          type="button"
          aria-label="Open menu"
          data-testid={`${testId}-menu`}
          onClick={openMenu}
          className="rounded-control border-line border p-2 md:hidden"
        >
          <Menu className="size-4" aria-hidden />
        </button>
      </div>
      <MobileNav
        testId={`${testId}-mobile`}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        deviceLabel={deviceLabel}
      />
    </header>
  )
}
