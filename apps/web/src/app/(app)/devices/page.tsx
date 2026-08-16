import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { DevicesIndex } from '@/components/devices/DevicesIndex'

export const metadata: Metadata = { title: 'Devices' }

const DevicesPage = (): ReactElement => (
  <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold tracking-tight">Devices</h1>
    <DevicesIndex testId="devices" />
  </div>
)

export default DevicesPage
