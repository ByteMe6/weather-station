'use client'

import dynamic from 'next/dynamic'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { stationPins } from './stationPins'

import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import type { MyDevice } from '@/services/devices/devices.service'

// Leaflet touches `window` at import time, so the map must never render on the
// server; the dynamic import also keeps ~43 KB gzipped off every other route.
const StationMap = dynamic(
  () => import('./StationMap').then((m) => m.StationMap),
  {
    ssr: false,
    loading: () => <Skeleton testId="station-map-skeleton" className="h-80" />,
  },
)

export const StationMapCard = ({
  devices,
  testId,
}: {
  devices: MyDevice[]
  testId: string
}): ReactElement | null => {
  const pins = useMemo(() => stationPins(devices), [devices])
  if (pins.length === 0) return null
  return (
    <Card testId={testId}>
      <CardBody testId={`${testId}-body`} className="pt-4">
        <StationMap testId={`${testId}-map`} pins={pins} />
      </CardBody>
    </Card>
  )
}
