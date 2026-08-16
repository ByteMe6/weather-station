'use client'

import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

import { fetchMyDevices } from './devices.service'

import { useSupabaseClient } from '@/lib/supabase'

export const deviceKeys = {
  all: ['devices'] as const,
  mine: ['devices', 'mine'] as const,
}

export const useMyDevicesQuery = () => {
  const client = useSupabaseClient()
  const { isSignedIn } = useUser()
  return useQuery({
    queryKey: deviceKeys.mine,
    queryFn: () => fetchMyDevices(client),
    enabled: !!isSignedIn,
  })
}
