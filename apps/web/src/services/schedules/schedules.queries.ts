'use client'

import { useUser } from '@clerk/nextjs'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createSchedule,
  deleteSchedule,
  fetchSchedules,
  updateSchedule,
} from './schedules.service'

import { useSupabaseClient } from '@/lib/supabase'

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: ['schedules', 'list'] as const,
}

export const useSchedulesQuery = () => {
  const client = useSupabaseClient()
  const { isSignedIn } = useUser()
  return useQuery({
    queryKey: scheduleKeys.list,
    queryFn: () => fetchSchedules(client),
    enabled: !!isSignedIn,
  })
}

const useInvalidateSchedules = () => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: scheduleKeys.all })
}

export const useCreateScheduleMutation = () => {
  const client = useSupabaseClient()
  const invalidate = useInvalidateSchedules()
  return useMutation({
    mutationFn: (input: {
      userId: string
      time: string
      timezone: string
      days: number[]
    }) => createSchedule(client, input),
    onSuccess: invalidate,
  })
}

export const useUpdateScheduleMutation = () => {
  const client = useSupabaseClient()
  const invalidate = useInvalidateSchedules()
  return useMutation({
    mutationFn: (input: {
      id: number
      time: string
      timezone: string
      days: number[]
    }) => updateSchedule(client, input),
    onSuccess: invalidate,
  })
}

export const useDeleteScheduleMutation = () => {
  const client = useSupabaseClient()
  const invalidate = useInvalidateSchedules()
  return useMutation({
    mutationFn: (input: { id: number }) => deleteSchedule(client, input),
    onSuccess: invalidate,
  })
}
