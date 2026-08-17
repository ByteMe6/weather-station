'use client'

import { useAuth } from '@clerk/nextjs'
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { ReactElement, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

/**
 * Clears the query cache when the signed-in user changes, signs out, or
 * switches organisation.
 *
 * The organisation matters as much as the user: `org_id` travels in the token
 * RLS reads, so the same query returns a different set before and after a
 * switch. Keeping the old entries would show fleet-wide rows to someone who
 * just dropped back to their personal account.
 */
const SignOutCleanup = (): null => {
  const { userId, orgId, isLoaded } = useAuth()
  const queryClient = useQueryClient()
  const prevIdentity = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!isLoaded) return
    const identity = `${userId ?? ''}:${orgId ?? ''}`
    if (
      prevIdentity.current !== undefined &&
      prevIdentity.current !== identity
    ) {
      queryClient.clear()
    }
    prevIdentity.current = identity
  }, [userId, orgId, isLoaded, queryClient])

  return null
}

export const QueryProvider = ({
  children,
}: {
  children: ReactNode
}): ReactElement => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
      }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <SignOutCleanup />
      {children}
      {process.env.NODE_ENV === 'development' ? (
        <ReactQueryDevtools initialIsOpen={false} />
      ) : null}
    </QueryClientProvider>
  )
}
