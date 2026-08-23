import { assertEquals } from '@std/assert'

import { runDispatch, type DueSlot } from '../alert-dispatcher/dispatch.ts'

const slot = (id: number): DueSlot => ({
  scheduleId: id,
  userId: `u${id}`,
  telegramId: 100 + id,
  slotTime: '07:30',
  slotTimezone: 'UTC',
  fireDate: '2026-08-24',
})

Deno.test('sends every claimed slot and marks it sent', async () => {
  const sent: number[] = []
  const marked: [number, string][] = []
  const summary = await runDispatch({
    claimDueSlots: () => Promise.resolve([slot(1), slot(2)]),
    buildMessage: (s) => Promise.resolve(`msg-${s.scheduleId}`),
    sendMessage: (chatId) => {
      sent.push(chatId)
      return Promise.resolve()
    },
    markDelivery: (id, _date, status) => {
      marked.push([id, status])
      return Promise.resolve()
    },
  })
  assertEquals(summary, { claimed: 2, sent: 2, failed: 0 })
  assertEquals(sent, [101, 102])
  assertEquals(marked, [
    [1, 'sent'],
    [2, 'sent'],
  ])
})

Deno.test(
  'one failing send is recorded and does not block others',
  async () => {
    const marked: [number, string, string | undefined][] = []
    const summary = await runDispatch({
      claimDueSlots: () => Promise.resolve([slot(1), slot(2), slot(3)]),
      buildMessage: (s) => Promise.resolve(`msg-${s.scheduleId}`),
      sendMessage: (chatId) =>
        chatId === 102
          ? Promise.reject(new Error('403: bot blocked'))
          : Promise.resolve(),
      markDelivery: (id, _date, status, error) => {
        marked.push([id, status, error])
        return Promise.resolve()
      },
    })
    assertEquals(summary, { claimed: 3, sent: 2, failed: 1 })
    assertEquals(marked[1], [2, 'failed', '403: bot blocked'])
  },
)
