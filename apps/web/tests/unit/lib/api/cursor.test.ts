import { decodeCursor, encodeCursor } from '@/lib/api/cursor'

describe('readings cursor', () => {
  it('round-trips the last row’s timestamp and id', () => {
    const c = { timestamp: '2026-10-01T08:55:00+00:00', id: 42 }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })

  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  it.each([
    [
      'unparseable offset',
      enc({ timestamp: '2026-10-01T08:55:00+99:99', id: 1 }),
    ],
    ['year 0000', enc({ timestamp: '0000-01-01T00:00:00Z', id: 1 })],
    [
      'id beyond safe integer',
      enc({ timestamp: '2026-10-01T00:00:00Z', id: 1e300 }),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull()
  })

  it.each([
    ['not base64 json', 'garbage'],
    [
      'filter injection in timestamp',
      Buffer.from(
        JSON.stringify({ timestamp: '2026),id.gt.0', id: 1 }),
      ).toString('base64url'),
    ],
    [
      'non-integer id',
      Buffer.from(
        JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', id: 1.5 }),
      ).toString('base64url'),
    ],
    [
      'extra field',
      Buffer.from(
        JSON.stringify({ timestamp: '2026-10-01T00:00:00Z', id: 1, x: 1 }),
      ).toString('base64url'),
    ],
  ])('rejects %s', (_label, raw) => {
    expect(decodeCursor(raw)).toBeNull()
  })
})
