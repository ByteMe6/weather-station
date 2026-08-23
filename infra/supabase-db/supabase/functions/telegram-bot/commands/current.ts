// PRD T4: /current — latest reading for every linked device, p95 < 2 s.
import type { SupabaseClient } from '@supabase/supabase-js'

import { formatCurrentMessage } from '../../_shared/format.ts'
import { fetchDeviceReadings, inferTimezone } from '../../_shared/readings.ts'
import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { backRow } from './menu.ts'

export const currentReply = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<Reply> => {
  const userId = await ensureUserId(db, telegramId)
  const devices = await fetchDeviceReadings(db, userId)
  if (devices.length === 0)
    return {
      text: 'No station is linked yet. Send /register <device-id> to connect one.',
      buttons: [
        [{ text: '🔗 Register Device', data: 'register:start' }],
        backRow(),
      ],
    }
  const timezone = await inferTimezone(db, userId)
  return {
    text: formatCurrentMessage(devices, timezone, new Date()),
    buttons: [backRow()],
  }
}
