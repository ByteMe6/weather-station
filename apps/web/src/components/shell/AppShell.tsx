'use client'

import type { ReactElement, ReactNode } from 'react'

import { Footer } from './Footer'
import { TopNav } from './TopNav'

import { useDeviceParam } from '@/components/dashboard/useDeviceParam'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'
import { deviceDisplayName } from '@/services/devices/devices.service'

export const AppShell = ({
  children,
  testId,
}: {
  children: ReactNode
  testId: string
}): ReactElement => {
  const { data: devices, isLoading } = useMyDevicesQuery()
  const [selected] = useDeviceParam()
  const current =
    devices?.find((d) => d.deviceId === selected) ?? devices?.[0] ?? null
  const deviceLabel = current ? deviceDisplayName(current) : null
  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col">
      <TopNav
        testId={`${testId}-nav`}
        deviceLabel={deviceLabel}
        devicesLoading={isLoading}
      />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-7 pb-16">
        {children}
      </main>
      <Footer testId={`${testId}-footer`} />
    </div>
  )
}
