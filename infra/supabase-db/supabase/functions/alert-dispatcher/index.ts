// Alert dispatcher (PRD T6/T7, OQ4): pg_cron → invoke_alert_dispatcher() →
// this function. Auth is the x-cron-secret header (config.toml sets
// verify_jwt = false; the new sb_secret keys are not JWTs).
import { serviceClient } from '../_shared/db.ts'
import { formatAlertMessage } from '../_shared/format.ts'
import { fetchDeviceReadings } from '../_shared/readings.ts'
import { runDispatch, type DueSlot } from './dispatch.ts'

const token = Deno.env.get('BOT_TOKEN')
if (!token) throw new Error('BOT_TOKEN is not set')
const cronSecret = Deno.env.get('CRON_SECRET')
if (!cronSecret) throw new Error('CRON_SECRET is not set')

const encoder = new TextEncoder()
const digest = async (value: string): Promise<string> => {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
// Hash both sides so the comparison cannot leak the secret's length or bytes.
const secretMatches = async (candidate: string | null): Promise<boolean> =>
  candidate !== null && (await digest(candidate)) === (await digest(cronSecret))

const sendTelegramMessage = async (
  chatId: number,
  text: string,
): Promise<void> => {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) throw new Error(`sendMessage ${res.status}: ${await res.text()}`)
}

Deno.serve(async (req) => {
  if (!(await secretMatches(req.headers.get('x-cron-secret')))) {
    return new Response('forbidden', { status: 403 })
  }
  const db = serviceClient()
  const summary = await runDispatch({
    claimDueSlots: async () => {
      const { data, error } = await db.rpc('claim_due_alert_slots')
      if (error) throw new Error(`claim failed: ${error.message}`)
      // rpc() rows cannot be aliased — map snake_case here (project rule).
      return ((data ?? []) as Record<string, unknown>[]).map(
        (r): DueSlot => ({
          scheduleId: r.schedule_id as number,
          userId: r.user_id as string,
          telegramId: r.telegram_id as number,
          slotTime: (r.slot_time as string).slice(0, 5),
          slotTimezone: r.slot_timezone as string,
          fireDate: r.fire_date as string,
        }),
      )
    },
    buildMessage: async (slot) => {
      const devices = await fetchDeviceReadings(db, slot.userId)
      if (devices.length === 0)
        return `⏰ Weather alert — ${slot.slotTime} ${slot.slotTimezone}\n\nNo station is linked to your account. Send /register <device-id> to connect one.`
      return formatAlertMessage(
        devices,
        { time: slot.slotTime, timezone: slot.slotTimezone },
        new Date(),
      )
    },
    sendMessage: sendTelegramMessage,
    markDelivery: async (scheduleId, fireDate, status, error) => {
      const { error: updateError } = await db
        .from('alert_deliveries')
        .update({ status, error: error ?? null })
        .eq('schedule_id', scheduleId)
        .eq('fire_date', fireDate)
      if (updateError)
        throw new Error(`delivery update failed: ${updateError.message}`)
    },
  })
  console.log('alert-dispatcher tick', summary)
  return Response.json(summary)
})
