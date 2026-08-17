'use client'

import { useClerk } from '@clerk/nextjs'
import { notFound, useRouter } from 'next/navigation'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'

import { getAdminStatusAction } from '@/actions/admin.action'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * The only /admin path the proxy lets a non-active session reach. Clerk only
 * puts `org_id` in the session token for the ACTIVE organisation, so a genuine
 * admin has to activate it once before either enforcer can see them.
 */
export const ActivateAdminOrg = ({
  testId,
}: {
  testId: string
}): ReactElement | null => {
  const router = useRouter()
  const { setActive } = useClerk()
  const [denied, setDenied] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const run = async () => {
      const res = await getAdminStatusAction()
      if (!res.ok || res.data.state === 'denied') {
        setDenied(true)
        return
      }
      if (res.data.state === 'needs-activation') {
        await setActive({ organization: res.data.orgId })
      }
      router.replace('/admin')
    }
    void run()
  }, [router, setActive])

  if (denied) notFound()
  return <Skeleton testId={`${testId}-working`} className="h-24" />
}
