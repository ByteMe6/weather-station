// PRD T5: alert slot management — text commands and the inline Alerts menu
// write the same `schedules` rows the web UI manages (MRP-42).
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  formatDays,
  isValidTimezone,
  parseAlertAdd,
  parseTime,
} from '../alerts-parse.ts'
import { inferTimezone } from '../../_shared/readings.ts'
import { ensureUserId } from '../identity.ts'
import type { Reply } from '../reply.ts'
import { addSlot, listSlots, removeSlotById, type Slot } from '../schedules.ts'
import { backRow } from './menu.ts'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const describeSlot = (s: Slot): string =>
  `${s.time} ${s.timezone} — ${formatDays(s.days)}`

export const listReply = (slots: Slot[]): Reply => {
  if (slots.length === 0)
    return {
      text: 'No alert slots yet. Add one and I will message you the weather on schedule.',
      buttons: [[{ text: '➕ Add alert', data: 'alerts:add' }], backRow()],
    }
  return {
    text: [
      'Your alert slots:',
      ...slots.map((s, i) => `${i + 1}. ${describeSlot(s)}`),
    ].join('\n'),
    buttons: [
      ...slots.map((s, i) => [
        { text: `🗑 Remove ${i + 1} (${s.time})`, data: `alerts:rm:${s.id}` },
      ]),
      [{ text: '➕ Add alert', data: 'alerts:add' }],
      backRow(),
    ],
  }
}

export const dayPickerReply = (bits: string): Reply => {
  const toggle = (i: number): string =>
    bits.slice(0, i) + (bits[i] === '1' ? '0' : '1') + bits.slice(i + 1)
  return {
    text: 'Pick the days for this alert, then press Done.',
    buttons: [
      DAY_LABELS.slice(0, 4).map((d, i) => ({
        text: `${bits[i] === '1' ? '✅ ' : ''}${d}`,
        data: `alerts:day:${toggle(i)}`,
      })),
      DAY_LABELS.slice(4).map((d, i) => ({
        text: `${bits[i + 4] === '1' ? '✅ ' : ''}${d}`,
        data: `alerts:day:${toggle(i + 4)}`,
      })),
      [{ text: '✔️ Done', data: `alerts:save:${bits}` }],
      backRow(),
    ],
  }
}

export const confirmRemoveReply = (slot: Slot): Reply => ({
  text: `Remove the ${describeSlot(slot)} alert?`,
  buttons: [
    [{ text: '🗑 Yes, remove it', data: `alerts:rmc:${slot.id}` }],
    backRow(),
  ],
})

const timezoneNote = (tz: string): string =>
  tz === 'UTC'
    ? 'Times are in UTC — append a zone to override, e.g. /alert add 07:30 Mon-Fri Europe/Kyiv'
    : `Times are in ${tz} (from your latest slot) — append a zone to override.`

export const saveSlot = async (
  db: SupabaseClient,
  telegramId: number,
  days: number[],
  rawTime: string,
  timezone?: string,
): Promise<Reply> => {
  const time = parseTime(rawTime)
  if (!time)
    return {
      text: `"${rawTime}" is not a valid 24-hour HH:MM time. Send e.g. 07:30.`,
    }
  if (timezone && !isValidTimezone(timezone))
    return { text: `"${timezone}" is not an IANA timezone (e.g. Europe/Kyiv).` }
  const userId = await ensureUserId(db, telegramId)
  const tz = timezone ?? (await inferTimezone(db, userId))
  const slot = await addSlot(db, { userId, time, timezone: tz, days })
  return {
    text: `✅ Alert saved: ${describeSlot(slot)}.\n${timezoneNote(tz)}`,
    buttons: [backRow()],
  }
}

export const handleAlertCommand = async (
  db: SupabaseClient,
  telegramId: number,
  rest: string,
): Promise<Reply> => {
  const [sub, ...args] = rest.trim().split(/\s+/).filter(Boolean)
  const userId = await ensureUserId(db, telegramId)
  if (sub === 'list' || sub === undefined)
    return listReply(await listSlots(db, userId))
  if (sub === 'add') {
    const parsed = parseAlertAdd(args.join(' '))
    if ('error' in parsed) return { text: parsed.error }
    return saveSlot(db, telegramId, parsed.days, parsed.time, parsed.timezone)
  }
  if (sub === 'remove') {
    const n = Number(args[0])
    const slots = await listSlots(db, userId)
    if (!Number.isInteger(n) || n < 1 || n > slots.length)
      return {
        text: `Usage: /alert remove <n> — n from /alert list (1–${slots.length || 0}).`,
      }
    const removed = await removeSlotById(db, userId, slots[n - 1].id)
    return {
      text: removed
        ? `🗑 Removed ${describeSlot(slots[n - 1])}.`
        : 'That slot is already gone.',
    }
  }
  return {
    text: 'Alert commands: /alert add HH:MM <days> [tz], /alert list, /alert remove <n>',
  }
}
