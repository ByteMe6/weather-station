// Bot-side access to the shared `schedules` table (same rows as the web UI).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Slot {
  id: number
  time: string
  timezone: string
  days: number[]
}

// Postgres returns `time` as 'HH:MM:SS'.
const toHHMM = (time: string): string => time.slice(0, 5)

export const listSlots = async (
  db: SupabaseClient,
  userId: string,
): Promise<Slot[]> => {
  const { data, error } = await db
    .from('schedules')
    .select('id, time, timezone, days')
    .eq('user_id', userId)
    .order('time', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw new Error(`schedule list failed: ${error.message}`)
  return (data ?? []).map((r) => ({
    ...(r as Slot),
    time: toHHMM(r.time as string),
  }))
}

export const addSlot = async (
  db: SupabaseClient,
  input: { userId: string; time: string; timezone: string; days: number[] },
): Promise<Slot> => {
  const { data, error } = await db
    .from('schedules')
    .insert({
      user_id: input.userId,
      time: input.time,
      timezone: input.timezone,
      days: input.days,
    })
    .select('id, time, timezone, days')
    .single()
  if (error) throw new Error(`schedule insert failed: ${error.message}`)
  return { ...(data as Slot), time: toHHMM(data.time as string) }
}

export const removeSlotById = async (
  db: SupabaseClient,
  userId: string,
  id: number,
): Promise<boolean> => {
  // .select() proves the delete hit a row (project rule: writes must prove it).
  const { data, error } = await db
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
  if (error) throw new Error(`schedule delete failed: ${error.message}`)
  return (data ?? []).length === 1
}
