'use client'

import { useUser } from '@clerk/nextjs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect } from 'react'

import { ShellSkeleton } from './ShellSkeleton'

import { ensureCurrentUserAction } from '@/actions/users.action'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { userKeys } from '@/services/users/users.queries'

/**
 * Gate: children render only once the users row exists (MRP-19). Runs once
 * per Clerk user per session; the QueryProvider clears state on sign-out.
 */
export const EnsureUser = ({
  children,
}: {
  children: ReactNode
}): ReactElement => {
  const { user, isLoaded } = useUser()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: ['users', 'ensure', user?.id ?? null],
    mutationFn: ensureCurrentUserAction,
    onSuccess: (result) => {
      if (result.ok)
        void queryClient.invalidateQueries({ queryKey: userKeys.current })
    },
  })
  const { mutate, isIdle } = mutation

  useEffect(() => {
    if (isLoaded && user && isIdle) mutate()
  }, [isLoaded, user, isIdle, mutate])

  const retry = useCallback(() => mutate(), [mutate])

  if (!isLoaded || mutation.isPending || mutation.isIdle) {
    return <ShellSkeleton testId="shell-skeleton" />
  }

  if (mutation.isError || (mutation.data && !mutation.data.ok)) {
    const message =
      mutation.data && !mutation.data.ok
        ? mutation.data.message
        : 'Something went wrong preparing your account.'
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        <EmptyState
          testId="ensure-user-error"
          title="We couldn't set up your account"
          description={message}
          action={
            <Button testId="ensure-user-retry" onClick={retry}>
              Try again
            </Button>
          }
        />
      </div>
    )
  }

  return <>{children}</>
}
