import { parseShareIdentifier } from '@/lib/share-identifier'

describe('parseShareIdentifier', () => {
  it('reads a run of digits as a Telegram id', () => {
    expect(parseShareIdentifier(' 123456 ')).toEqual({
      kind: 'telegram',
      telegramId: 123456,
    })
  })

  it('reads an email address, normalised to trimmed lowercase', () => {
    expect(parseShareIdentifier('  Ada@Example.COM ')).toEqual({
      kind: 'email',
      email: 'ada@example.com',
    })
  })

  it('no longer accepts a raw Clerk user id (MRP-38: owners never see one)', () => {
    expect(parseShareIdentifier('user_2abcDEF12345')).toBeNull()
  })

  it.each([
    ['neither an email nor digits', 'nope'],
    ['a local part with no domain', 'ada@'],
    ['a domain with no local part', '@example.com'],
    ['an empty string', ''],
    ['spaces inside an address', 'ada lovelace@example.com'],
  ])('rejects %s', (_label, raw) => {
    expect(parseShareIdentifier(raw)).toBeNull()
  })
})
