import { auth } from '@clerk/nextjs/server'
import { notFound } from 'next/navigation'
import type { ReactElement, ReactNode } from 'react'

import { isAdminOrg } from '@/lib/admin/org'

/**
 * Layer 2 of the gate: the proxy already redirects non-admins, but a layout
 * that trusted the proxy would hand the whole console to anything that slips
 * past the matcher. 404, never 403 — the console's existence is not public.
 */
const AdminLayout = async ({
  children,
}: {
  children: ReactNode
}): Promise<ReactElement> => {
  const { orgId } = await auth()
  if (!isAdminOrg(orgId)) notFound()
  return (
    <section data-testid="admin-shell" className="flex flex-col gap-6">
      {children}
    </section>
  )
}

export default AdminLayout
