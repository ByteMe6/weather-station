'use client'

import { useAuth } from '@clerk/nextjs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { fetchAllDevices, fetchAllUsers } from './admin.service'

import {
  createDeviceAction,
  deleteDeviceAction,
  getAdminStatusAction,
  rotateDeviceSecretAction,
  unclaimDeviceAction,
} from '@/actions/admin.action'
import { unwrapAction } from '@/lib/actions/unwrap'
import { useSupabaseClient } from '@/lib/supabase'

export const adminKeys = {
  all: ['admin'] as const,
  // Keyed by the active organisation: activating the admin org has to produce a
  // fresh answer, not the `denied` cached moments earlier (found in browser
  // verification — the nav entry stayed hidden after activation).
  status: (orgId: string | null | undefined) =>
    ['admin', 'status', orgId ?? null] as const,
  devices: ['admin', 'devices'] as const,
  users: ['admin', 'users'] as const,
}

/**
 * Whether this session may use the console. Also drives the nav entry, so it
 * runs for every signed-in user — a `denied` answer is the normal case and is
 * cached rather than retried.
 */
export const useAdminStatusQuery = () => {
  const { orgId, isLoaded } = useAuth()
  return useQuery({
    queryKey: adminKeys.status(orgId),
    queryFn: async () => unwrapAction(await getAdminStatusAction()),
    enabled: isLoaded,
    // Short, because this drives a warning banner: a five-minute cache meant a
    // mismatch that had already been fixed kept being reported, and returning
    // to the tab did not re-check it.
    staleTime: 30_000,
    retry: false,
  })
}

export const useAdminDevicesQuery = (enabled: boolean) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: adminKeys.devices,
    queryFn: () => fetchAllDevices(client),
    enabled,
  })
}

export const useAdminUsersQuery = (enabled: boolean) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: () => fetchAllUsers(client),
    enabled,
  })
}

const useInvalidateFleet = () => {
  const queryClient = useQueryClient()
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
    [queryClient],
  )
}

export const useCreateDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async () => unwrapAction(await createDeviceAction()),
    onSuccess: invalidate,
  })
}

export const useRotateSecretMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string }) =>
      unwrapAction(await rotateDeviceSecretAction(input)),
    onSuccess: invalidate,
  })
}

export const useUnclaimDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string }) =>
      unwrapAction(await unclaimDeviceAction(input)),
    onSuccess: invalidate,
  })
}

export const useDeleteDeviceMutation = () => {
  const invalidate = useInvalidateFleet()
  return useMutation({
    mutationFn: async (input: { deviceId: string; confirmation: string }) =>
      unwrapAction(await deleteDeviceAction(input)),
    onSuccess: invalidate,
  })
}
