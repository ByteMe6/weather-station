const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const helpers = {
  resolveCurrentUserId: jest.fn<Promise<string | null>, unknown[]>(),
}
jest.mock('@/actions/_helpers', () => helpers)

const insert = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const maybeSingle = jest.fn<Promise<{ data: unknown }>, []>()
const update = jest.fn<unknown, [unknown]>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => insert(row),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      update: (patch: unknown) => {
        update(patch)
        return { eq: async () => ({ error: null }) }
      },
      table,
    }),
  }),
}))

import {
  getTelegramLinkStatusAction,
  startTelegramLinkAction,
  unlinkTelegramAction,
} from '@/actions/telegram.action'

describe('telegram actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME = 'WsWeatherBot'
  })

  it('start inserts a code with a 10-minute expiry and returns the deep link', async () => {
    insert.mockResolvedValue({ error: null })
    const res = await startTelegramLinkAction()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.deepLink).toBe(
      `https://t.me/WsWeatherBot?start=link_${res.data.code}`,
    )
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ code: res.data.code, user_id: 'uuid-1' }),
    )
    const exp = new Date(res.data.expiresAt).getTime() - Date.now()
    expect(exp).toBeGreaterThan(9 * 60_000)
  })

  it.each([
    [{ consumed_at: 't', expires_at: 'x', failed_reason: null }, 'linked'],
    [
      {
        consumed_at: null,
        expires_at: '2999-01-01T00:00:00Z',
        failed_reason: 'nope',
      },
      'failed',
    ],
    [
      {
        consumed_at: null,
        expires_at: '2000-01-01T00:00:00Z',
        failed_reason: null,
      },
      'expired',
    ],
    [
      {
        consumed_at: null,
        expires_at: '2999-01-01T00:00:00Z',
        failed_reason: null,
      },
      'pending',
    ],
  ])('status maps %j → %s', async (row, state) => {
    maybeSingle.mockResolvedValue({ data: row })
    await expect(
      getTelegramLinkStatusAction({ code: 'ABC' }),
    ).resolves.toMatchObject({
      ok: true,
      data: { state },
    })
  })

  it('unlink nulls telegram_id for the current user only', async () => {
    await expect(unlinkTelegramAction()).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(update).toHaveBeenCalledWith({ telegram_id: null })
  })
})
