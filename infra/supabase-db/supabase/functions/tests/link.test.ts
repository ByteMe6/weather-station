// MRP-39: the pure reply/error builders of the linking + merge path.
import { assertEquals, assertStringIncludes } from '@std/assert'

import { linkedText, mapMergeError } from '../telegram-bot/link.ts'

const BASE =
  'Linked! Your Telegram account is now connected to your Weather Station account.'

Deno.test('linkedText: a plain link says nothing about merging', () => {
  assertEquals(
    linkedText({ merged: false, devicesMoved: 0, schedulesMoved: 0 }),
    BASE,
  )
})

Deno.test(
  'linkedText: an unreadable rpc payload degrades to the plain text',
  () => {
    assertEquals(linkedText(null), BASE)
  },
)

Deno.test('linkedText: a merge that carried nothing stays quiet', () => {
  assertEquals(
    linkedText({ merged: true, devicesMoved: 0, schedulesMoved: 0 }),
    BASE,
  )
})

Deno.test('linkedText: names stations and alerts that moved', () => {
  const text = linkedText({ merged: true, devicesMoved: 2, schedulesMoved: 3 })
  assertStringIncludes(text, '2 stations and 3 alerts')
})

Deno.test('linkedText: singular when exactly one moved', () => {
  const text = linkedText({ merged: true, devicesMoved: 1, schedulesMoved: 1 })
  assertStringIncludes(text, '1 station and 1 alert')
})

Deno.test('linkedText: omits the half that moved nothing', () => {
  const devicesOnly = linkedText({
    merged: true,
    devicesMoved: 1,
    schedulesMoved: 0,
  })
  assertStringIncludes(devicesOnly, '1 station')
  assertEquals(devicesOnly.includes('alert'), false)

  const alertsOnly = linkedText({
    merged: true,
    devicesMoved: 0,
    schedulesMoved: 4,
  })
  assertStringIncludes(alertsOnly, '4 alerts')
  assertEquals(alertsOnly.includes('station'), false)
})

Deno.test('mapMergeError: the account is already linked elsewhere', () => {
  assertStringIncludes(
    mapMergeError('ALREADY_LINKED_OTHER'),
    'already linked to a different Telegram account',
  )
})

Deno.test(
  'mapMergeError: the telegram id belongs to another web account',
  () => {
    assertStringIncludes(
      mapMergeError('TELEGRAM_BELONGS_TO_ACCOUNT'),
      'already linked to another user',
    )
  },
)

Deno.test('mapMergeError: anything else stays generic', () => {
  assertEquals(mapMergeError('deadlock detected'), 'Could not link right now.')
})
