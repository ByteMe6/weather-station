'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { DeviceChip } from './DeviceChip'
import { NAV_ITEMS } from './nav-items'
import { OrgSwitcher } from './OrgSwitcher'

import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'
import type { MyDevice } from '@/services/devices/devices.service'

interface MobileNavProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceLabel: string | null
  devices: MyDevice[]
  selectedDeviceId: string | null
  onSelectDevice: (deviceId: string) => void
  devicesLoading?: boolean
}

export const MobileNav = ({
  testId,
  open,
  onOpenChange,
  deviceLabel,
  devices,
  selectedDeviceId,
  onSelectDevice,
  devicesLoading = false,
}: MobileNavProps): ReactElement => {
  const pathname = usePathname()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  // Picking a station is the whole point of opening the drawer for it; leaving
  // the sheet up afterwards hides the dashboard the choice just changed.
  const selectDevice = useCallback(
    (deviceId: string) => {
      onSelectDevice(deviceId)
      onOpenChange(false)
    },
    [onSelectDevice, onOpenChange],
  )
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
      {/* Below lg these are the ONLY way to switch station or organisation —
          the top bar drops both to keep the row inside the viewport. */}
      <div className="border-line mt-4 flex flex-col gap-3 border-t pt-4">
        <DeviceChip
          testId={`${testId}-device`}
          devices={devices}
          selectedDeviceId={selectedDeviceId}
          onSelect={selectDevice}
          loading={devicesLoading}
          className="inline-flex"
        />
        <OrgSwitcher testId={`${testId}-org`} className="inline-flex" />
      </div>
    </Sheet>
  )
}
