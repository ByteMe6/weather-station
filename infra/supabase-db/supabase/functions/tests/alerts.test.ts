import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'

import { dayPickerReply, listReply } from '../telegram-bot/commands/alerts.ts'
import type { Slot } from '../telegram-bot/schedules.ts'

const slots: Slot[] = [
  { id: 7, time: '07:30', timezone: 'Europe/Kyiv', days: [1, 2, 3, 4, 5] },
  { id: 9, time: '19:00', timezone: 'UTC', days: [6, 7] },
]

Deno.test('listReply numbers slots and attaches remove buttons by id', () => {
  const r = listReply(slots)
  assertMatch(r.text, /1\. 07:30 Europe\/Kyiv — Mon–Fri/)
  assertMatch(r.text, /2\. 19:00 UTC — Sat, Sun/)
  const removeData = (r.buttons ?? []).flat().map((b) => b.data)
  assertStringIncludes(removeData.join(' '), 'alerts:rm:7')
  assertStringIncludes(removeData.join(' '), 'alerts:rm:9')
})

Deno.test('listReply has an empty state', () => {
  assertMatch(listReply([]).text, /no alert slots yet/i)
})

Deno.test('dayPickerReply toggles bits and carries them into save', () => {
  const r = dayPickerReply('1010100')
  const flat = (r.buttons ?? []).flat()
  const mon = flat.find((b) => b.text.includes('Mon'))
  assertEquals(mon?.data, 'alerts:day:0010100') // toggling Mon flips bit 1 off
  const done = flat.find((b) => b.data.startsWith('alerts:save:'))
  assertEquals(done?.data, 'alerts:save:1010100')
})
