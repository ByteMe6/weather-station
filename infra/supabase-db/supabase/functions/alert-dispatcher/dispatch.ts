// Pure orchestration for one dispatcher tick. All I/O is injected so the
// failure-isolation contract (T7: one blocked bot never breaks the rest)
// is provable in unit tests.
export interface DueSlot {
  scheduleId: number
  userId: string
  telegramId: number
  slotTime: string
  slotTimezone: string
  fireDate: string
}

export interface DispatchDeps {
  claimDueSlots: () => Promise<DueSlot[]>
  buildMessage: (slot: DueSlot) => Promise<string>
  sendMessage: (chatId: number, text: string) => Promise<void>
  markDelivery: (
    scheduleId: number,
    fireDate: string,
    status: 'sent' | 'failed',
    error?: string,
  ) => Promise<void>
}

export const runDispatch = async (
  deps: DispatchDeps,
): Promise<{ claimed: number; sent: number; failed: number }> => {
  const slots = await deps.claimDueSlots()
  let sent = 0
  let failed = 0
  for (const slot of slots) {
    try {
      const text = await deps.buildMessage(slot)
      await deps.sendMessage(slot.telegramId, text)
      await deps.markDelivery(slot.scheduleId, slot.fireDate, 'sent')
      sent++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      try {
        await deps.markDelivery(slot.scheduleId, slot.fireDate, 'failed', message)
      } catch (markErr) {
        // The delivery row stays 'claimed'; log so the trace is not lost.
        console.error('markDelivery failed', { slot: slot.scheduleId, markErr })
      }
    }
  }
  return { claimed: slots.length, sent, failed }
}
