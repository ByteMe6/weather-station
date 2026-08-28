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

// ---------------------------------------------------------------------------
// handleLinkCode: redemption is a single RPC. This was previously untested —
// the two-round-trip version could strand a user between claiming the code and
// merging, and nothing here would have noticed.
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleLinkCode } from '../telegram-bot/link.ts'

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

const fakeDb = (reply: { data?: unknown; error?: { message: string } }) => {
  const calls: RpcCall[] = []
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return Promise.resolve({
        data: reply.data ?? null,
        error: reply.error ?? null,
      })
    },
  } as unknown as SupabaseClient
  return { db, calls }
}

const row = (over: Record<string, unknown> = {}) => ({
  outcome: 'linked',
  reason: null,
  merged: false,
  devices_moved: 0,
  schedules_moved: 0,
  ...over,
})

Deno.test('handleLinkCode: redeems in exactly one round trip', async () => {
  const { db, calls } = fakeDb({ data: row() })
  await handleLinkCode(db, 'ABCDEFGHJKMNPQRSTVWX', 4242)
  assertEquals(calls.length, 1)
  assertEquals(calls[0].fn, 'redeem_telegram_link_code')
  assertEquals(calls[0].args, {
    p_code: 'ABCDEFGHJKMNPQRSTVWX',
    p_telegram_id: 4242,
  })
})

Deno.test(
  'handleLinkCode: a plain link confirms without merge talk',
  async () => {
    const { db } = fakeDb({ data: row() })
    assertEquals(await handleLinkCode(db, 'CODE', 1), BASE)
  },
)

Deno.test('handleLinkCode: a merge names what came across', async () => {
  const { db } = fakeDb({
    data: row({ merged: true, devices_moved: 2, schedules_moved: 1 }),
  })
  assertStringIncludes(
    await handleLinkCode(db, 'CODE', 1),
    '2 stations and 1 alert',
  )
})

Deno.test('handleLinkCode: an expired code says so', async () => {
  const { db } = fakeDb({ data: row({ outcome: 'expired' }) })
  assertStringIncludes(await handleLinkCode(db, 'CODE', 1), 'expired')
})

Deno.test('handleLinkCode: an unknown or spent code says so', async () => {
  const { db } = fakeDb({ data: row({ outcome: 'invalid' }) })
  assertStringIncludes(
    await handleLinkCode(db, 'CODE', 1),
    'invalid or was already used',
  )
})

Deno.test('handleLinkCode: a refusal reports the mapped reason', async () => {
  const { db } = fakeDb({
    data: row({ outcome: 'refused', reason: 'ALREADY_LINKED_OTHER' }),
  })
  assertStringIncludes(
    await handleLinkCode(db, 'CODE', 1),
    'already linked to a different Telegram account',
  )
})

Deno.test(
  'handleLinkCode: a refused telegram id reports its own reason',
  async () => {
    const { db } = fakeDb({
      data: row({ outcome: 'refused', reason: 'TELEGRAM_BELONGS_TO_ACCOUNT' }),
    })
    assertStringIncludes(
      await handleLinkCode(db, 'CODE', 1),
      'already linked to another user',
    )
  },
)

Deno.test(
  'handleLinkCode: an rpc failure stays generic, never "already used"',
  async () => {
    const { db } = fakeDb({ error: { message: 'connection reset' } })
    assertEquals(
      await handleLinkCode(db, 'CODE', 1),
      'Could not link right now.',
    )
  },
)

Deno.test(
  'handleLinkCode: an unreadable payload degrades to generic',
  async () => {
    const { db } = fakeDb({ data: { outcome: 'nonsense' } })
    assertEquals(
      await handleLinkCode(db, 'CODE', 1),
      'Could not link right now.',
    )
  },
)
