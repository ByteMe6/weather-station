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

/** Clears the query cache when the signed-in user changes or signs out. */
const SignOutCleanup = (): null => {
  const { userId, isLoaded } = useAuth()
  const queryClient = useQueryClient()
  const prevUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!isLoaded) return
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      queryClient.clear()
    }
    prevUserId.current = userId
  }, [userId, isLoaded, queryClient])

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
