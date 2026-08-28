// PRD T3: /register <device-id> — reuses the atomic claim_device() RPC the
// web flow uses (one owner per device, OQ3).
import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { backRow } from './menu.ts'

export const normaliseDeviceId = (raw: string): string =>
  raw.trim().toLowerCase()

export const mapClaimError = (message: string): string => {
  if (message.includes('DEVICE_NOT_FOUND'))
    return 'I do not know that device id. Check the label on your station and try again.'
  // Usually this is the same person arriving from the other side: they
  // registered the station on the web, and this chat is a separate
  // telegram-only account. Linking the two from Settings merges them, so name
  // that route instead of dead-ending on "belongs to someone else".
  if (message.includes('DEVICE_ALREADY_CLAIMED'))
    return 'That station is already registered. If it is yours, open Settings on the web and link Telegram — this chat will then see it.'
  return 'Could not register right now. Please try again in a minute.'
}

export const registerPrompt = (): Reply => ({
  text: 'Send me the device id (printed on the station label), e.g. ws-a1b2c3.',
  buttons: [backRow()],
})

export const registerDevice = async (
  db: SupabaseClient,
  telegramId: number,
  rawId: string,
): Promise<Reply> => {
  const deviceId = normaliseDeviceId(rawId)
  if (!deviceId)
    return {
      text: 'Usage: /register <device-id> — the id is on the device label.',
    }
  const userId = await ensureUserId(db, telegramId)

  const { data: existing, error: memberError } = await db
    .from('device_users')
    .select('role')
    .eq('device_id', deviceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (memberError)
    return {
      text: 'Could not register right now. Please try again in a minute.',
    }
  if (existing)
    return {
      text: `✅ ${deviceId} is already registered to you. Try /current.`,
    }

  const { error } = await db.rpc('claim_device', {
    p_device_id: deviceId,
    p_user_id: userId,
  })
  if (error) return { text: mapClaimError(error.message) }
  return {
    text: `✅ Linked! ${deviceId} is now your station. Try /current — and /menu → Alerts to schedule updates.`,
  }
}
