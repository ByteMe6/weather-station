// Pending multi-step flow state, persisted in bot_sessions (spec §Data model).
import type { SupabaseClient } from '@supabase/supabase-js'

export type SessionState =
  | { kind: 'awaiting_device_id' }
  | { kind: 'awaiting_alert_time'; days: number[] }

const SESSION_TTL_MS = 10 * 60 * 1000

const isDayList = (v: unknown): v is number[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)

export const parseSessionState = (value: unknown): SessionState | null => {
  if (typeof value !== 'object' || value === null) return null
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'awaiting_device_id') return { kind: 'awaiting_device_id' }
  if (kind === 'awaiting_alert_time') {
    const days = (value as { days?: unknown }).days
    if (isDayList(days)) return { kind: 'awaiting_alert_time', days }
  }
  return null
}

export const getSession = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<SessionState | null> => {
  const { data, error } = await db
    .from('bot_sessions')
    .select('state, expiresAt:expires_at')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) throw new Error(`session read failed: ${error.message}`)
  if (!data) return null
  if (new Date(data.expiresAt as string).getTime() < Date.now()) {
    await clearSession(db, telegramId)
    return null
  }
  return parseSessionState(data.state)
}

export const setSession = async (
  db: SupabaseClient,
  telegramId: number,
  state: SessionState,
): Promise<void> => {
  const { error } = await db.from('bot_sessions').upsert({
    telegram_id: telegramId,
    state,
    updated_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`session write failed: ${error.message}`)
}

export const clearSession = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<void> => {
  const { error } = await db
    .from('bot_sessions')
    .delete()
    .eq('telegram_id', telegramId)
  if (error) throw new Error(`session clear failed: ${error.message}`)
}
