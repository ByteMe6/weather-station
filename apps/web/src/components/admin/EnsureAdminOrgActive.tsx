'use client'

import { useAuth, useClerk } from '@clerk/nextjs'
import type { ReactElement, ReactNode } from 'react'
import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * True once the browser session's active organisation is the admin org, which
 * is what RLS compares (`auth.jwt() ->> 'org_id'`). Tables gate their queries
 * on it so an inactive session shows a skeleton rather than an empty fleet —
 * RLS quietly falls back to "your own rows", and that reads as "no devices".
 */
const AdminOrgReadyContext = createContext(false)

export const useAdminOrgReady = (): boolean => useContext(AdminOrgReadyContext)

/**
 * Keeps the admin organisation active for the browser session.
 *
 * It never unmounts its children: `useAuth().orgId` can blink between Clerk
 * token refreshes, and tearing the subtree down on that would destroy state
 * that cannot be recovered — a freshly minted device secret is shown exactly
 * once (observed in browser verification: a device was created and its secret
 * lost). Readiness is published through context instead.
 */
export const EnsureAdminOrgActive = ({
  orgId,
  children,
}: {
  orgId: string
  children: ReactNode
}): ReactElement => {
  const { orgId: activeOrgId, isLoaded } = useAuth()
  const { setActive } = useClerk()
  const requested = useRef(false)
  const isActive = isLoaded && activeOrgId === orgId

  useEffect(() => {
    if (isActive || !isLoaded || requested.current) return
    requested.current = true
    void setActive({ organization: orgId })
  }, [isActive, isLoaded, orgId, setActive])

  return (
    <AdminOrgReadyContext.Provider value={isActive}>
      {children}
    </AdminOrgReadyContext.Provider>
  )
}
