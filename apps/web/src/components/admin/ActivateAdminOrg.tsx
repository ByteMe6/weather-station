'use client'

import { useClerk } from '@clerk/nextjs'
import { notFound } from 'next/navigation'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'

import { getAdminStatusAction } from '@/actions/admin.action'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { hardNavigate } from '@/lib/navigate'

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
  const { setActive } = useClerk()
  const [denied, setDenied] = useState(false)
  const [failed, setFailed] = useState(false)
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
        // `redirectUrl` makes Clerk navigate only once the session actually
        // carries the organisation. Navigating ourselves right after the
        // promise resolves raced Clerk's session sync: the org never stuck, so
        // every later token had `org_id: null` and the gate refused a genuine
        // admin (found in browser verification).
        await setActive({
          organization: res.data.orgId,
          redirectUrl: '/admin',
        })
        return
      }
      // Already active: a full document load, so the server sees this session.
      hardNavigate('/admin')
    }
    // Without this catch a rejected getAdminStatusAction()/setActive() left a
    // genuine admin staring at a skeleton forever, with `ran` blocking retry.
    void run().catch((err: unknown) => {
      console.error('ActivateAdminOrg failed', err)
      ran.current = false
      setFailed(true)
    })
  }, [setActive])

  if (denied) notFound()
  if (failed) {
    return (
      <EmptyState
        testId={`${testId}-failed`}
        title="Couldn't open the admin console"
        description="We couldn't reach Clerk to activate your organisation. Reload the page to try again."
      />
    )
  }
  return <Skeleton testId={`${testId}-working`} className="h-24" />
}
