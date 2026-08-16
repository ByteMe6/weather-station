'use client'

import { useUser } from '@clerk/nextjs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DeviceRole } from '@ws/shared'
import { useCallback } from 'react'

import { fetchDeviceMembers, fetchMyDevices } from './devices.service'

import {
  getDeviceMemberProfilesAction,
  registerDeviceAction,
  removeMemberAction,
  shareDeviceAction,
  updateDeviceProfileAction,
  updateMemberRoleAction,
} from '@/actions/devices.action'
import { unwrapAction } from '@/lib/actions/unwrap'
import { useSupabaseClient } from '@/lib/supabase'

export const deviceKeys = {
  all: ['devices'] as const,
  mine: ['devices', 'mine'] as const,
  members: (deviceId: string) => ['devices', 'members', deviceId] as const,
  memberProfiles: (deviceId: string) =>
    ['devices', 'member-profiles', deviceId] as const,
}

// Names come from Clerk, not our DB — a Realtime event will never refresh
// them, so hold them a while and refetch on membership changes (invalidated
// with deviceKeys.members by the sharing actions' callers).
const PROFILES_STALE_MS = 5 * 60_000

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

/**
 * Members' display names/avatars, resolved by a server action from Clerk
 * (server path: the browser never sees a Clerk id). Keyed by users.id.
 */
export const useDeviceMemberProfilesQuery = (deviceId: string | undefined) =>
  useQuery({
    queryKey: deviceKeys.memberProfiles(deviceId ?? ''),
    queryFn: async () =>
      unwrapAction(
        await getDeviceMemberProfilesAction({ deviceId: deviceId! }),
      ),
    enabled: !!deviceId,
    staleTime: PROFILES_STALE_MS,
  })

/**
 * Everything that changes who can see a station or what it is called runs as a
 * server action (service role + explicit ownership checks), but the cache is
 * still TanStack's: each mutation unwraps the action's result union, throws on
 * failure so `onError`/`isError` behave normally, and invalidates the keys the
 * change can affect.
 */
const useInvalidateDevice = (deviceId: string) => {
  const queryClient = useQueryClient()
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deviceKeys.members(deviceId) }),
      queryClient.invalidateQueries({
        queryKey: deviceKeys.memberProfiles(deviceId),
      }),
      queryClient.invalidateQueries({ queryKey: deviceKeys.mine }),
    ])
  }, [deviceId, queryClient])
}

export const useRegisterDeviceMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { deviceId: string }) =>
      unwrapAction(await registerDeviceAction(input)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
  })
}

export const useShareDeviceMutation = (deviceId: string) => {
  const invalidate = useInvalidateDevice(deviceId)
  return useMutation({
    mutationFn: async (input: { identifier: string; role: DeviceRole }) =>
      unwrapAction(await shareDeviceAction({ deviceId, ...input })),
    onSuccess: invalidate,
  })
}

export const useUpdateMemberRoleMutation = (deviceId: string) => {
  const invalidate = useInvalidateDevice(deviceId)
  return useMutation({
    mutationFn: async (input: { userId: string; role: DeviceRole }) =>
      unwrapAction(await updateMemberRoleAction({ deviceId, ...input })),
    onSuccess: invalidate,
  })
}

export const useRemoveMemberMutation = (deviceId: string) => {
  const invalidate = useInvalidateDevice(deviceId)
  return useMutation({
    mutationFn: async (input: { userId: string }) =>
      unwrapAction(await removeMemberAction({ deviceId, ...input })),
    onSuccess: invalidate,
  })
}

export const useUpdateDeviceProfileMutation = (deviceId: string) => {
  const invalidate = useInvalidateDevice(deviceId)
  return useMutation({
    mutationFn: async (input: { label: string; address: string }) =>
      unwrapAction(await updateDeviceProfileAction({ deviceId, ...input })),
    onSuccess: invalidate,
  })
}
