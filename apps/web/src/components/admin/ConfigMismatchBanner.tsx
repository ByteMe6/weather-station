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
  if (status.data?.state !== 'ok' || !status.data.configMismatch) return null
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
