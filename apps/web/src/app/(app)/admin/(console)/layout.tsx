import { notFound } from 'next/navigation'
import type { ReactElement, ReactNode } from 'react'

import { EnsureAdminOrgActive } from '@/components/admin/EnsureAdminOrgActive'
import { isAdminRequest } from '@/lib/admin/access'
import { adminOrgId } from '@/lib/admin/org'

/**
 * Layer 2 of the gate: the proxy already redirects non-admins, but a layout
 * that trusted the proxy would hand the whole console to anything that slips
 * past the matcher. 404, never 403 — the console's existence is not public.
 *
 * This wraps the `(console)` group only. `/admin/activate` deliberately sits
 * outside it: that route exists for an admin whose organisation is not active
 * yet, and gating it here would 404 exactly the people it serves (found in
 * browser verification).
 */
const AdminConsoleLayout = async ({
  children,
}: {
  children: ReactNode
}): Promise<ReactElement> => {
  if (!(await isAdminRequest())) notFound()
  const orgId = adminOrgId()
  if (!orgId) notFound()
  return (
    <section data-testid="admin-shell" className="flex flex-col gap-6">
      {/* The org id is not a secret — the admin can already see it in their own
          Clerk memberships — and the client needs it to keep the organisation
          active so RLS grants the fleet-wide view. */}
      <EnsureAdminOrgActive testId="admin-org" orgId={orgId}>
        <>{children}</>
      </EnsureAdminOrgActive>
    </section>
  )
}

export default AdminConsoleLayout
