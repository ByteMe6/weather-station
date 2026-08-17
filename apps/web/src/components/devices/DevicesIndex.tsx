'use client'

import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { NoDeviceState } from '@/components/dashboard/NoDeviceState'
import { StationMapCard } from '@/components/map/StationMapCard'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'
import { deviceDisplayName } from '@/services/devices/devices.service'

export const DevicesIndex = ({ testId }: { testId: string }): ReactElement => {
  const { isLoaded } = useUser()
  const { data, isLoading, isError } = useMyDevicesQuery()
  if (!isLoaded || isLoading) {
    return <Skeleton testId={`${testId}-skeleton`} className="h-24" />
  }
  // A failed read is not "you have no stations" — that prompt would invite the
  // user to register a station they already own.
  if (isError) {
    return (
      <EmptyState
        testId={`${testId}-error`}
        title="Couldn't load your stations"
        description="Something went wrong reaching the server. Reload to try again."
      />
    )
  }
  if (!data || data.length === 0)
    return <NoDeviceState testId={`${testId}-empty`} />
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <StationMapCard testId={`${testId}-map`} devices={data} />
      {data.map((d) => (
        <Link
          key={d.deviceId}
          href={`/devices/${d.deviceId}`}
          data-testid={`${testId}-${d.deviceId}`}
        >
          <Card
            testId={`${testId}-card-${d.deviceId}`}
            className="hover:bg-paper transition-colors"
          >
            <CardBody
              testId={`${testId}-card-${d.deviceId}-body`}
              className="flex items-center gap-3 pt-4"
            >
              <div className="flex flex-col">
                <span className="text-sm font-semibold">
                  {deviceDisplayName(d)}
                </span>
                <span className="text-slate font-mono text-xs">
                  {d.deviceId}
                  {d.device?.address ? (
                    <span className="font-sans"> · {d.device.address}</span>
                  ) : null}
                </span>
                {d.role === 'owner' &&
                (d.device?.latitude === null ||
                  d.device?.latitude === undefined) ? (
                  <span
                    data-testid={`${testId}-hint-${d.deviceId}`}
                    className="text-slate text-[12px]"
                  >
                    Add coordinates in station details to see it on the map
                  </span>
                ) : null}
              </div>
              <Badge testId={`${testId}-card-${d.deviceId}-role`}>
                {d.role}
              </Badge>
              <span className="flex-1" />
              <span className="text-slate text-xs">
                since {new Date(d.addedAt).toLocaleDateString()}
              </span>
            </CardBody>
          </Card>
        </Link>
      ))}
      <Link
        href="/devices/register"
        data-testid={`${testId}-register`}
        className="text-slate text-sm font-medium underline-offset-2 hover:underline"
      >
        Register another station
      </Link>
    </div>
  )
}
