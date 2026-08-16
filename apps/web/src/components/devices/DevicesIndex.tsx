'use client'

import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { NoDeviceState } from '@/components/dashboard/NoDeviceState'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'

export const DevicesIndex = ({ testId }: { testId: string }): ReactElement => {
  const { isLoaded } = useUser()
  const { data, isLoading } = useMyDevicesQuery()
  if (!isLoaded || isLoading) {
    return <Skeleton testId={`${testId}-skeleton`} className="h-24" />
  }
  if (!data || data.length === 0)
    return <NoDeviceState testId={`${testId}-empty`} />
  return (
    <div data-testid={testId} className="flex flex-col gap-3">
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
              <span className="font-mono text-sm font-semibold">
                {d.deviceId}
              </span>
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
