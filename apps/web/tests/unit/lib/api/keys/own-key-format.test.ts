import {
  OWN_KEY_PREFIX,
  generateOwnKey,
  hashOwnKey,
  isOwnKeyFormat,
  ownKeyHint,
} from '@/lib/api/keys/own-key-format'

describe('own API key format', () => {
  it('generates prefixed keys with 32 random bytes of base64url', () => {
    const key = generateOwnKey()
    expect(key.startsWith(OWN_KEY_PREFIX)).toBe(true)
    expect(key.slice(OWN_KEY_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(isOwnKeyFormat(key)).toBe(true)
  })

  it('never generates the same key twice in a row', () => {
    expect(generateOwnKey()).not.toBe(generateOwnKey())
  })

  it.each([
    ['empty', ''],
    ['wrong prefix', `ak_live_${'a'.repeat(43)}`],
    ['short body', `${OWN_KEY_PREFIX}${'a'.repeat(42)}`],
    ['long body', `${OWN_KEY_PREFIX}${'a'.repeat(44)}`],
    ['bad character', `${OWN_KEY_PREFIX}${'a'.repeat(42)}=`],
  ])('rejects %s', (_label, token) => {
    expect(isOwnKeyFormat(token)).toBe(false)
  })

  it('hashes to lowercase hex SHA-256, deterministically', () => {
    // sha256("abc")
    expect(hashOwnKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hashOwnKey('abc')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hints with the last four characters', () => {
    expect(ownKeyHint(`${OWN_KEY_PREFIX}${'a'.repeat(39)}WXYZ`)).toBe('WXYZ')
  })
})
