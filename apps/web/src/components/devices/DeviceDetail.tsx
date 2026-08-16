'use client'

import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { DeviceHeader } from './DeviceHeader'
import { MembersList } from './MembersList'
import { ShareDialog } from './ShareDialog'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useDeviceMembersQuery,
  useMyDevicesQuery,
} from '@/services/devices/devices.queries'
import { useCurrentUserQuery } from '@/services/users/users.queries'

export const DeviceDetail = ({
  deviceId,
  testId,
}: {
  deviceId: string
  testId: string
}): ReactElement => {
  const { isLoaded } = useUser()
  const me = useCurrentUserQuery()
  const mine = useMyDevicesQuery()
  const members = useDeviceMembersQuery(deviceId)
  const [shareOpen, setShareOpen] = useState(false)
  const openShare = useCallback(() => setShareOpen(true), [])

  const link = useMemo(
    () => mine.data?.find((d) => d.deviceId === deviceId) ?? null,
    [mine.data, deviceId],
  )
  const isLoading =
    !isLoaded || me.isLoading || mine.isLoading || members.isLoading

  if (isLoading) {
    return (
      <div data-testid={`${testId}-skeleton`} className="flex flex-col gap-4">
        <Skeleton testId={`${testId}-skeleton-h`} className="h-7 w-72" />
        <Skeleton testId={`${testId}-skeleton-c`} className="h-48" />
      </div>
    )
  }
  if (!link) {
    return (
      <EmptyState
        testId={`${testId}-missing`}
        title="You don't have access to this station"
        description="Ask an owner to share it, or register your own."
        action={
          <Link
            href="/devices"
            className="text-sm font-medium underline underline-offset-2"
          >
            Back to devices
          </Link>
        }
      />
    )
  }
  const canManage = link.role === 'owner'
  return (
    <div data-testid={testId} className="flex flex-col gap-6">
      <DeviceHeader
        testId={`${testId}-header`}
        deviceId={deviceId}
        status={link.device?.status ?? null}
        role={link.role}
      />
      <Card testId={`${testId}-members`}>
        <CardHeader testId={`${testId}-members-header`}>
          <CardTitle testId={`${testId}-members-title`}>
            People with access
          </CardTitle>
          <span className="flex-1" />
          {canManage ? (
            <Button testId={`${testId}-share`} size="sm" onClick={openShare}>
              Share access
            </Button>
          ) : null}
        </CardHeader>
        <CardBody testId={`${testId}-members-body`}>
          {canManage ? null : (
            <p className="text-slate mb-2 text-[13px]">
              Only owners can share this station.
            </p>
          )}
          <MembersList
            testId={`${testId}-list`}
            deviceId={deviceId}
            members={members.data ?? []}
            viewerUserId={me.data?.id ?? null}
            canManage={canManage}
          />
        </CardBody>
      </Card>
      <ShareDialog
        testId={`${testId}-share-dialog`}
        deviceId={deviceId}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  )
}
