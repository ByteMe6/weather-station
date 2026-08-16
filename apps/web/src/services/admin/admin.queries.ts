'use client'

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
  status: ['admin', 'status'] as const,
  devices: ['admin', 'devices'] as const,
  users: ['admin', 'users'] as const,
}

/**
 * Whether this session may use the console. Also drives the nav entry, so it
 * runs for every signed-in user — a `denied` answer is the normal case and is
 * cached rather than retried.
 */
export const useAdminStatusQuery = () =>
  useQuery({
    queryKey: adminKeys.status,
    queryFn: async () => unwrapAction(await getAdminStatusAction()),
    staleTime: 5 * 60_000,
    retry: false,
  })

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
