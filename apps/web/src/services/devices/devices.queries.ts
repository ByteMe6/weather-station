'use client'

import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

import { fetchDeviceMembers, fetchMyDevices } from './devices.service'

import { useSupabaseClient } from '@/lib/supabase'

export const deviceKeys = {
  all: ['devices'] as const,
  mine: ['devices', 'mine'] as const,
  members: (deviceId: string) => ['devices', 'members', deviceId] as const,
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

export const useDeviceMembersQuery = (deviceId: string | undefined) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: deviceKeys.members(deviceId ?? ''),
    queryFn: () => fetchDeviceMembers(client, { deviceId: deviceId! }),
    enabled: !!deviceId,
  })
}
