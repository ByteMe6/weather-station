import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { DeviceDetail } from '@/components/devices/DeviceDetail'

export const metadata: Metadata = { title: 'Device' }

const DevicePage = async ({
  params,
}: {
  params: Promise<{ deviceId: string }>
}): Promise<ReactElement> => {
  const { deviceId } = await params
  return <DeviceDetail deviceId={deviceId} testId="device" />
}

export default DevicePage
