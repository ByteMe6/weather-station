'use client'

import { useAuth, useClerk } from '@clerk/nextjs'
import type { ReactElement } from 'react'
import { useEffect, useRef } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

/**
 * Keeps the admin organisation active for the browser session.
 *
 * The server decides admin access from Clerk membership (see lib/admin/access),
 * but RLS compares `auth.jwt() ->> 'org_id'`, which is only populated for the
 * session's ACTIVE organisation. Without this, an admin whose org lapsed would
 * see the console render and every table come back empty — RLS quietly falling
 * back to "your own rows" (observed in browser verification).
 */
export const EnsureAdminOrgActive = ({
  orgId,
  children,
  testId,
}: {
  orgId: string
  children: ReactElement
  testId: string
}): ReactElement => {
  const { orgId: activeOrgId, isLoaded } = useAuth()
  const { setActive } = useClerk()
  const requested = useRef(false)

  useEffect(() => {
    if (!isLoaded || requested.current || activeOrgId === orgId) return
    requested.current = true
    void setActive({ organization: orgId })
  }, [isLoaded, activeOrgId, orgId, setActive])

  if (!isLoaded || activeOrgId !== orgId) {
    return <Skeleton testId={`${testId}-activating`} className="h-40" />
  }
  return children
}
