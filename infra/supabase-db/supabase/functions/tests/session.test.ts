import { assertEquals } from '@std/assert'

import { parseSessionState } from '../telegram-bot/session.ts'

Deno.test('parseSessionState accepts the two known states', () => {
  assertEquals(parseSessionState({ kind: 'awaiting_device_id' }), {
    kind: 'awaiting_device_id',
  })
  assertEquals(
    parseSessionState({ kind: 'awaiting_alert_time', days: [1, 3, 5] }),
    { kind: 'awaiting_alert_time', days: [1, 3, 5] },
  )
})

Deno.test('parseSessionState rejects malformed values', () => {
  assertEquals(parseSessionState(null), null)
  assertEquals(parseSessionState({ kind: 'nope' }), null)
  assertEquals(parseSessionState({ kind: 'awaiting_alert_time' }), null)
  assertEquals(
    parseSessionState({ kind: 'awaiting_alert_time', days: [0, 8] }),
    null,
  )
  assertEquals(
    parseSessionState({ kind: 'awaiting_alert_time', days: [] }),
    null,
  )
})
