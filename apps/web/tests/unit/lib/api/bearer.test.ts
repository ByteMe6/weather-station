import { parseBearer } from '@/lib/api/bearer'

describe('parseBearer', () => {
  it.each([
    ['Bearer abc', 'abc'],
    ['bearer abc', 'abc'],
    ['Bearer   abc  ', 'abc'],
  ])('%j → %j', (header, token) => {
    expect(parseBearer(header)).toBe(token)
  })

  it.each([
    ['missing', null],
    ['empty', ''],
    ['basic auth', 'Basic dXNlcjpwYXNz'],
    ['scheme only', 'Bearer'],
    ['two tokens', 'Bearer a b'],
    ['oversize', `Bearer ${'a'.repeat(257)}`],
  ])('rejects %s', (_label, header) => {
    expect(parseBearer(header)).toBeNull()
  })
})
