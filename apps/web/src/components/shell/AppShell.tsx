'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactElement, ReactNode } from 'react'
import { useCallback, useMemo } from 'react'

import { Footer } from './Footer'
import { TopNav } from './TopNav'

import { useDeviceParam } from '@/components/dashboard/useDeviceParam'
import { useAdminStatusQuery } from '@/services/admin/admin.queries'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'
import { deviceDisplayName } from '@/services/devices/devices.service'

export const AppShell = ({
  children,
  testId,
}: {
  children: ReactNode
  testId: string
}): ReactElement => {
  const router = useRouter()
  const pathname = usePathname()
  const { data: devices, isLoading } = useMyDevicesQuery()
  const adminStatus = useAdminStatusQuery()
  const [selected, setSelected] = useDeviceParam()
  const list = useMemo(() => devices ?? [], [devices])
  // On a device page the route segment *is* the station, so switching has to
  // navigate; everywhere else the selection just rides along in ?device=.
  const detailDeviceId = /^\/devices\/(?!register$)([^/]+)$/.exec(pathname)?.[1]
  const current =
    list.find((d) => d.deviceId === (detailDeviceId ?? selected)) ??
    list[0] ??
    null
  const deviceLabel = current ? deviceDisplayName(current) : null
  const onSelectDevice = useCallback(
    (deviceId: string) => {
      if (detailDeviceId) router.push(`/devices/${deviceId}`)
      else setSelected(deviceId)
    },
    [detailDeviceId, router, setSelected],
  )
  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col">
      <TopNav
        testId={`${testId}-nav`}
        devices={list}
        selectedDeviceId={current?.deviceId ?? null}
        onSelectDevice={onSelectDevice}
        deviceLabel={deviceLabel}
        devicesLoading={isLoading}
        showAdmin={adminStatus.data?.state === 'ok'}
      />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-7 pb-16">
        {children}
      </main>
      <Footer testId={`${testId}-footer`} />
    </div>
  )
}
