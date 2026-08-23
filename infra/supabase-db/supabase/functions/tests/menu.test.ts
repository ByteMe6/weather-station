import { assertEquals, assertMatch } from '@std/assert'

import {
  aboutReply,
  mainMenu,
  unknownReply,
} from '../telegram-bot/commands/menu.ts'
import { startReply } from '../telegram-bot/commands/start.ts'

Deno.test('mainMenu renders the four T2 buttons with routed callback data', () => {
  const rows = mainMenu().buttons ?? []
  const flat = rows.flat()
  assertEquals(
    flat.map((b) => b.data),
    ['menu:current', 'menu:alerts', 'register:start', 'menu:about'],
  )
})

Deno.test('start explains registration (T1)', () => {
  assertMatch(startReply().text, /\/register/)
})

Deno.test('about and unknown replies point somewhere useful', () => {
  assertMatch(aboutReply().text, /weather/i)
  assertMatch(unknownReply().text, /\/menu/)
})
