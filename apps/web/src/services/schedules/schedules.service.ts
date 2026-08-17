import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertSchedule } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

import { normaliseTime } from '@/lib/schedule'

const COLUMNS = 'id, userId:user_id, time, timezone, days, createdAt:created_at'
// Postgres returns `time` as 'HH:MM:SS'; PostgREST cannot reformat a column in
// the select, so this is the one post-map in the schedules service.
const tidy = (row: AlertSchedule): AlertSchedule => ({
  ...row,
  time: normaliseTime(row.time),
})

/** Own alert slots (RLS: users can view own schedules), earliest first. */
export const fetchSchedules = async (
  supabase: SupabaseClient<Database>,
): Promise<AlertSchedule[]> => {
  const { data, error } = await supabase
    .from('schedules')
    .select(COLUMNS)
    .order('time', { ascending: true })
  if (error) {
    throw new ServiceError(
      `Failed to fetch schedules: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return (data ?? []).map(tidy)
}

export const createSchedule = async (
  supabase: SupabaseClient<Database>,
  input: { userId: string; time: string; timezone: string; days: number[] },
): Promise<AlertSchedule> => {
  const { data, error } = await supabase
    .from('schedules')
    .insert({
      user_id: input.userId,
      time: normaliseTime(input.time),
      timezone: input.timezone,
      days: input.days,
    })
    .select(COLUMNS)
    .single()
  if (error) {
    throw new ServiceError(
      `Failed to create schedule: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return tidy(data)
}

export const updateSchedule = async (
  supabase: SupabaseClient<Database>,
  input: { id: number; time: string; timezone: string; days: number[] },
): Promise<AlertSchedule> => {
  const { data, error } = await supabase
    .from('schedules')
    .update({
      time: normaliseTime(input.time),
      timezone: input.timezone,
      days: input.days,
    })
    .eq('id', input.id)
    .select(COLUMNS)
    .single()
  if (error) {
    throw new ServiceError(
      `Failed to update schedule: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return tidy(data)
}

export const deleteSchedule = async (
  supabase: SupabaseClient<Database>,
  input: { id: number },
): Promise<void> => {
  // `.select()` matters on the client path: a row RLS hides is simply not
  // deleted and PostgREST reports no error, so without this the UI would
  // confirm an alert was deleted while it still exists.
  const { data, error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', input.id)
    .select('id')
  if (error) {
    throw new ServiceError(
      `Failed to delete schedule: ${error.message}`,
      error.code,
      error.details,
    )
  }
  if ((data ?? []).length !== 1) {
    throw new ServiceError('Alert not found or not yours', 'NOT_FOUND')
  }
}
