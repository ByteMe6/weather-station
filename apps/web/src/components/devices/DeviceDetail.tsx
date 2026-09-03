'use client'

import { useUser } from '@clerk/nextjs'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { DeviceHeader } from './DeviceHeader'
import { DeviceProfileDialog } from './DeviceProfileDialog'
import { MembersList } from './MembersList'
import { ShareDialog } from './ShareDialog'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  useDeviceMemberProfilesQuery,
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
  const profiles = useDeviceMemberProfilesQuery(deviceId)
  const [shareOpen, setShareOpen] = useState(false)
  const openShare = useCallback(() => setShareOpen(true), [])
  const [profileOpen, setProfileOpen] = useState(false)
  const openProfile = useCallback(() => setProfileOpen(true), [])

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
  // Only claim "no access" when the reads succeeded: a network failure used to
  // produce a false authorization message about a device the user owns.
  if (mine.isError || members.isError) {
    return (
      <EmptyState
        testId={`${testId}-error`}
        title="Couldn't load this station"
        description="Something went wrong reaching the server. Reload to try again."
      />
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
  // Two different authorities, deliberately not one flag. Editing the station's
  // details is open to editors; anything that changes who has access is not.
  const canManageMembers = link.role === 'owner'
  const canEditProfile = link.role === 'owner' || link.role === 'editor'
  return (
    <div data-testid={testId} className="flex flex-col gap-6">
      <DeviceHeader
        testId={`${testId}-header`}
        deviceId={deviceId}
        label={link.device?.label ?? null}
        address={link.device?.address ?? null}
        status={link.device?.status ?? null}
        role={link.role}
        action={
          canEditProfile ? (
            <Button
              testId={`${testId}-edit`}
              variant="ghost"
              size="sm"
              onClick={openProfile}
            >
              Edit details
            </Button>
          ) : null
        }
      />
      <Card testId={`${testId}-members`}>
        <CardHeader testId={`${testId}-members-header`}>
          <CardTitle testId={`${testId}-members-title`}>
            People with access
          </CardTitle>
          <span className="flex-1" />
          {canManageMembers ? (
            <Button testId={`${testId}-share`} size="sm" onClick={openShare}>
              Share access
            </Button>
          ) : null}
        </CardHeader>
        <CardBody testId={`${testId}-members-body`}>
          {canManageMembers ? null : (
            <p className="text-slate mb-2 text-[13px]">
              Only owners can share this station.
            </p>
          )}
          <MembersList
            testId={`${testId}-list`}
            deviceId={deviceId}
            members={members.data ?? []}
            profiles={profiles.data}
            viewerUserId={me.data?.id ?? null}
            canManage={canManageMembers}
          />
        </CardBody>
      </Card>
      <ShareDialog
        testId={`${testId}-share-dialog`}
        deviceId={deviceId}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
      {profileOpen ? (
        <DeviceProfileDialog
          testId={`${testId}-profile-dialog`}
          deviceId={deviceId}
          label={link.device?.label ?? null}
          address={link.device?.address ?? null}
          latitude={link.device?.latitude ?? null}
          longitude={link.device?.longitude ?? null}
          open={profileOpen}
          onOpenChange={setProfileOpen}
        />
      ) : null}
    </div>
  )
}
