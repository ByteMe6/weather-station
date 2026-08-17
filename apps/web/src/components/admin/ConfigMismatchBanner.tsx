'use client'

import type { ReactElement } from 'react'

import { useAdminStatusQuery } from '@/services/admin/admin.queries'

/**
 * ADMIN_ORG_ID (server actions) and the Vault secret admin_org_id (RLS) are two
 * stores of one value. If they drift, one enforcer allows what the other
 * denies — which looks like random empty tables rather than a config error.
 */
export const ConfigMismatchBanner = ({
  testId,
}: {
  testId: string
}): ReactElement | null => {
  const status = useAdminStatusQuery()
  if (status.data?.state !== 'ok') return null
  // A vault RPC that failed is not drift: telling the operator to run
  // admin:set-org would send them after a config problem that does not exist.
  if (status.data.configUnavailable) {
    return (
      <p
        data-testid={`${testId}-unavailable`}
        role="alert"
        className="rounded-card border-line bg-card text-slate border p-3 text-sm"
      >
        <b className="text-ink">
          Couldn&apos;t verify the admin configuration.
        </b>{' '}
        The Supabase Vault secret{' '}
        <code className="font-mono">admin_org_id</code> could not be read, so
        row access may not match page access. Check the database and reload.
      </p>
    )
  }
  if (!status.data.configMismatch) return null
  return (
    <p
      data-testid={testId}
      role="alert"
      className="rounded-card border-danger/40 bg-danger/10 text-danger border p-3 text-sm"
    >
      <b>Admin configuration mismatch.</b> ADMIN_ORG_ID and the Supabase Vault
      secret <code className="font-mono">admin_org_id</code> hold different
      values, so page access and row access disagree. Fix with{' '}
      <code className="font-mono">yarn admin:set-org &lt;org_id&gt;</code> from
      infra/supabase-db, or correct the environment variable.
    </p>
  )
}
