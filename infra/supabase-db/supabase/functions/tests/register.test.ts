import { assertMatch } from '@std/assert'

import {
  mapClaimError,
  normaliseDeviceId,
} from '../telegram-bot/commands/register.ts'

Deno.test('claim errors map to friendly messages (OQ3)', () => {
  assertMatch(mapClaimError('DEVICE_NOT_FOUND'), /do not know that device/i)
  // A claimed station is usually the same person arriving from the other
  // side, so the message has to point at linking rather than dead-ending.
  assertMatch(
    mapClaimError('DEVICE_ALREADY_CLAIMED'),
    /already registered.*link Telegram/is,
  )
  assertMatch(mapClaimError('connection reset'), /could not register/i)
})

Deno.test(
  'device ids are trimmed and lowercased (provisioning CLI stores lowercase)',
  () => {
    assertMatch(normaliseDeviceId('  WS-A1B2C3  '), /^ws-a1b2c3$/)
  },
)
