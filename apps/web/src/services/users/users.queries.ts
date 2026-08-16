'use client'

import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

import { fetchCurrentUser } from './users.service'

import { useSupabaseClient } from '@/lib/supabase'

export const userKeys = {
  all: ['users'] as const,
  current: ['users', 'current'] as const,
}

export const useCurrentUserQuery = () => {
  const client = useSupabaseClient()
  const { isSignedIn } = useUser()
  return useQuery({
    queryKey: userKeys.current,
    queryFn: () => fetchCurrentUser(client),
    enabled: !!isSignedIn,
  })
}
