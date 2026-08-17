'use client'

import type { ReactElement } from 'react'

import { useAdminOrgReady } from './EnsureAdminOrgActive'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAdminUsersQuery } from '@/services/admin/admin.queries'
import type { AdminUser } from '@/services/admin/admin.service'

/**
 * Admins can read full identifiers through RLS, but showing them serves no
 * purpose — the tail is enough to match a person to a support request, and it
 * keeps the console consistent with the sharing UI.
 */
const identifier = (user: AdminUser): string => {
  if (user.clerkUserId) return `user_…${user.clerkUserId.slice(-4)}`
  if (user.telegramId !== null)
    return `tg · …${String(user.telegramId).slice(-4)}`
  return 'unknown'
}

export const AdminUsersTable = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  // Visible only while the admin organisation is active in this session: until
  // then RLS answers with the caller's own rows, which would render as an empty
  // users list rather than "still loading".
  const ready = useAdminOrgReady()
  const { data, isLoading, isError, error } = useAdminUsersQuery(ready)

  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>Users</CardTitle>
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        {!ready || isLoading ? (
          <Skeleton testId={`${testId}-skeleton`} className="h-40" />
        ) : isError ? (
          <EmptyState
            testId={`${testId}-error`}
            title="Couldn't load the user list"
            description={
              error instanceof Error
                ? error.message
                : 'Reload the page. If it persists, check ADMIN_ORG_ID against the Vault secret.'
            }
          />
        ) : !data || data.length === 0 ? (
          <EmptyState
            testId={`${testId}-empty`}
            title="No users yet"
            description="Accounts appear here after their first sign-in."
          />
        ) : (
          <ul className="flex flex-col">
            {data.map((u) => (
              <li
                key={u.id}
                data-testid={`${testId}-row-${u.id}`}
                className="border-line flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
              >
                <span className="font-mono text-sm">{identifier(u)}</span>
                {u.telegramId !== null ? (
                  <Badge testId={`${testId}-row-${u.id}-telegram`} tone="live">
                    telegram
                  </Badge>
                ) : null}
                <span className="flex-1" />
                <span className="text-slate text-[13px]">
                  {u.deviceCount} {u.deviceCount === 1 ? 'station' : 'stations'}
                </span>
                <span className="text-slate text-xs">
                  since {new Date(u.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
