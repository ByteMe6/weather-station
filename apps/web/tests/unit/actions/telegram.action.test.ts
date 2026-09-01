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
    // A refusal leaves the code unspent, so failed_reason outlives the TTL.
    // Both refusal messages say to open the same link again — which the RPC
    // stops honouring at expiry, so past it the card was telling the user to
    // do something that could not work. Expiry wins on an unspent code.
    [
      {
        consumed_at: null,
        expires_at: '2000-01-01T00:00:00Z',
        failed_reason: 'ALREADY_LINKED_OTHER',
      },
      'expired',
    ],
    // ...but a code that WAS spent keeps reporting its failure, expired or not:
    // there is nothing to reopen, and the reason is the whole explanation.
    [
      {
        consumed_at: 't',
        expires_at: '2000-01-01T00:00:00Z',
        failed_reason: 'TELEGRAM_BELONGS_TO_ACCOUNT',
      },
      'failed',
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

  it('keeps polling, rather than failing, if a spent code has no link yet', async () => {
    // redeem_telegram_link_code() consumes and merges in one transaction, so
    // this state should not occur. It used to be reported as a terminal
    // "Linking did not finish", which stopped the poll for good and condemned
    // links that had in fact succeeded — so if it ever recurs, treat it as
    // still in flight.
    maybeSingle.mockResolvedValue({
      data: {
        consumed_at: 't',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        failed_reason: null,
      },
    })
    userRow.mockResolvedValue({ data: { telegram_id: null }, error: null })
    await expect(
      getTelegramLinkStatusAction({ code: CODE }),
    ).resolves.toMatchObject({ ok: true, data: { state: 'pending' } })
  })

  it('an expired spent code with no link reports expired, not pending forever', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        consumed_at: 't',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        failed_reason: null,
      },
    })
    userRow.mockResolvedValue({ data: { telegram_id: null }, error: null })
    await expect(
      getTelegramLinkStatusAction({ code: CODE }),
    ).resolves.toMatchObject({ ok: true, data: { state: 'expired' } })
  })

  it('translates the machine failure reason the RPC recorded', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        consumed_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        failed_reason: 'ALREADY_LINKED_OTHER',
      },
    })
    const result = await getTelegramLinkStatusAction({ code: CODE })
    expect(result).toMatchObject({ ok: true, data: { state: 'failed' } })
    expect(result.ok && result.data.reason).toMatch(
      /already linked to a different Telegram account/i,
    )
  })

  it('an unrecognised failure reason still reads as English', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        consumed_at: null,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        failed_reason: 'SOMETHING_NEW',
      },
    })
    const result = await getTelegramLinkStatusAction({ code: CODE })
    expect(result.ok && result.data.reason).toMatch(/could not finish linking/i)
  })

  it('unlink nulls telegram_id for the current user only', async () => {
    await expect(unlinkTelegramAction()).resolves.toEqual({
      ok: true,
      data: null,
    })
    expect(update).toHaveBeenCalledWith({ telegram_id: null })
  })
})
