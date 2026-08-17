'use client'

import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { CreateDeviceDialog } from './CreateDeviceDialog'
import { DeviceRowActions } from './DeviceRowActions'
import { useAdminOrgReady } from './EnsureAdminOrgActive'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAdminDevicesQuery } from '@/services/admin/admin.queries'

/**
 * Every station in the fleet, read through the admin RLS policy. There is no
 * column, tooltip or title here that can hold a secret: `devices.secret` is not
 * granted to any client role, so it cannot even be selected.
 */
export const AdminDevicesTable = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  // Visible only while the admin organisation is active in this session: until
  // then RLS answers with the caller's own rows, which would render as an empty
  // fleet list rather than "still loading".
  const ready = useAdminOrgReady()
  const { data, isLoading, isError, error } = useAdminDevicesQuery(ready)
  const [createOpen, setCreateOpen] = useState(false)
  const openCreate = useCallback(() => setCreateOpen(true), [])
  const closeCreate = useCallback((next: boolean) => setCreateOpen(next), [])

  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>Fleet</CardTitle>
        <span className="flex-1" />
        <Button testId={`${testId}-create`} size="sm" onClick={openCreate}>
          Create device
        </Button>
      </CardHeader>
      <CardBody testId={`${testId}-body`} className="pt-3">
        {!ready || isLoading ? (
          <Skeleton testId={`${testId}-skeleton`} className="h-40" />
        ) : isError ? (
          <EmptyState
            testId={`${testId}-error`}
            title="Couldn't load the fleet"
            description={
              error instanceof Error
                ? error.message
                : 'Reload the page. If it persists, check ADMIN_ORG_ID against the Vault secret.'
            }
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            testId={`${testId}-empty`}
            title="No devices yet"
            description="Create one to mint its id and HMAC secret."
          />
        ) : (
          <ul className="flex flex-col">
            {data.map((d) => (
              <li
                key={d.deviceId}
                data-testid={`${testId}-row-${d.deviceId}`}
                className="border-line flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {d.label ?? 'Unnamed station'}
                  </span>
                  <span className="text-slate font-mono text-[11px]">
                    {d.deviceId}
                  </span>
                </span>
                <Badge
                  testId={`${testId}-row-${d.deviceId}-status`}
                  tone={d.status === 'registered' ? 'live' : 'muted'}
                >
                  {d.status}
                </Badge>
                <span className="text-slate text-[13px]">
                  {d.memberCount} {d.memberCount === 1 ? 'member' : 'members'}
                </span>
                <span className="flex-1" />
                <span className="text-slate text-xs">
                  {new Date(d.createdAt).toLocaleDateString()}
                </span>
                <DeviceRowActions
                  testId={`${testId}-row-${d.deviceId}-actions`}
                  deviceId={d.deviceId}
                  memberCount={d.memberCount}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CreateDeviceDialog
        testId={`${testId}-create-dialog`}
        open={createOpen}
        onOpenChange={closeCreate}
      />
    </Card>
  )
}
