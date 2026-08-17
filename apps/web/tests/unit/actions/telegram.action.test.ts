const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const helpers = {
  resolveCurrentUserId: jest.fn<Promise<string | null>, unknown[]>(),
}
jest.mock('@/actions/_helpers', () => helpers)

const insert = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const maybeSingle = jest.fn<Promise<{ data: unknown; error?: unknown }>, []>()
// "Claimed" is no longer taken as "linked": the action now confirms
// users.telegram_id actually landed, so the users lookup is mocked separately.
const userRow = jest.fn<Promise<{ data: unknown; error: unknown }>, []>()
const CODE = 'ABCDEFGHJKMNPQRSTVWX'
const update = jest.fn<unknown, [unknown]>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => insert(row),
      select: () =>
        table === 'users'
          ? { eq: () => ({ maybeSingle: () => userRow() }) }
          : { eq: () => ({ eq: () => ({ maybeSingle }) }) },
      update: (patch: unknown) => {
        update(patch)
        return {
          eq: () => ({
            select: async () => ({ data: [{ id: 'u1' }], error: null }),
          }),
        }
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
    userRow.mockResolvedValue({ data: { telegram_id: 987654 }, error: null })
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
    // the bot claims (consumed_at) before writing users.telegram_id, so a
    // failed attempt has both set — failure wins
    [{ consumed_at: 't', expires_at: 'x', failed_reason: 'taken' }, 'failed'],
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
      getTelegramLinkStatusAction({ code: CODE }),
    ).resolves.toMatchObject({
      ok: true,
      data: { state },
    })
  })

  it('status rejects malformed codes without a query and unknown users as UNAUTHORIZED', async () => {
    await expect(
      getTelegramLinkStatusAction({ code: 'abc' }),
    ).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(maybeSingle).not.toHaveBeenCalled()
    helpers.resolveCurrentUserId.mockResolvedValue(null)
    await expect(
      getTelegramLinkStatusAction({ code: CODE }),
    ).resolves.toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('reports failed, not linked, when the code was claimed but the link never landed', async () => {
    // The bot marks the code consumed before writing users.telegram_id; if that
    // second write dies the row still reads as consumed.
    maybeSingle.mockResolvedValue({
      data: { consumed_at: 't', expires_at: 'x', failed_reason: null },
    })
    userRow.mockResolvedValue({ data: { telegram_id: null }, error: null })
    await expect(
      getTelegramLinkStatusAction({ code: CODE }),
    ).resolves.toMatchObject({ ok: true, data: { state: 'failed' } })
  })

  it('unlink nulls telegram_id for the current user only', async () => {
    await expect(unlinkTelegramAction()).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(update).toHaveBeenCalledWith({ telegram_id: null })
  })
})
