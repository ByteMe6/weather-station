import {
  fieldErrorsFrom,
  readingsQuerySchema,
  resolveWindow,
  stationPatchSchema,
} from '@/lib/api/schemas'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-01T12:00:00.000Z')

describe('resolveWindow', () => {
  it('defaults to [now - default span, now]', () => {
    expect(resolveWindow({}, DAY, 31 * DAY, NOW)).toEqual({
      ok: true,
      window: {
        from: '2026-09-30T12:00:00.000Z',
        to: '2026-10-01T12:00:00.000Z',
      },
    })
  })

  it('anchors a missing from on the given to', () => {
    const r = resolveWindow({ to: '2026-09-01T00:00:00Z' }, DAY, 31 * DAY, NOW)
    expect(r).toEqual({
      ok: true,
      window: {
        from: '2026-08-31T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
      },
    })
  })

  it('rejects from >= to', () => {
    const r = resolveWindow(
      { from: '2026-09-02T00:00:00Z', to: '2026-09-01T00:00:00Z' },
      DAY,
      31 * DAY,
      NOW,
    )
    expect(r).toMatchObject({
      ok: false,
      fieldErrors: { from: expect.any(String) as string },
    })
  })

  it('rejects a span over the cap', () => {
    const r = resolveWindow(
      { from: '2026-08-01T00:00:00Z', to: '2026-09-02T00:00:00Z' },
      DAY,
      31 * DAY,
      NOW,
    )
    expect(r).toMatchObject({ ok: false })
  })
})

describe('resolveWindow with unparseable input', () => {
  it('reports the bad field instead of producing NaN', () => {
    expect(
      resolveWindow({ from: '2026-10-01T08:55:00+99:99' }, DAY, 31 * DAY, NOW),
    ).toMatchObject({
      ok: false,
      fieldErrors: { from: expect.any(String) as string },
    })
    expect(resolveWindow({ to: 'nonsense' }, DAY, 31 * DAY, NOW)).toMatchObject(
      { ok: false, fieldErrors: { to: expect.any(String) as string } },
    )
  })
})

describe('readingsQuerySchema', () => {
  it('defaults the limit and coerces it from the query string', () => {
    expect(readingsQuerySchema.parse({})).toEqual({ limit: 288 })
    expect(readingsQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 })
  })

  it.each([
    ['limit over max', { limit: '1001' }],
    ['limit not a number', { limit: 'abc' }],
    ['from without timezone', { from: '2026-10-01T00:00:00' }],
    ['unknown parameter', { form: '2026-10-01T00:00:00Z' }],
    ['unparseable offset', { from: '2026-10-01T08:55:00+99:99' }],
    ['year before 1970', { to: '0000-01-01T00:00:00Z' }],
    ['hex limit', { limit: '0x10' }],
    ['exponent limit', { limit: '1e2' }],
  ])('rejects %s', (_label, input) => {
    expect(readingsQuerySchema.safeParse(input).success).toBe(false)
  })
})

describe('stationPatchSchema', () => {
  it('accepts a partial body with nulls', () => {
    expect(
      stationPatchSchema.parse({ label: ' Roof ', address: null }),
    ).toEqual({
      label: 'Roof',
      address: null,
    })
  })

  it.each([
    ['empty object', {}],
    ['unknown key', { name: 'x' }],
    ['empty string label', { label: '   ' }],
    ['label too long', { label: 'x'.repeat(41) }],
    ['latitude out of range', { latitude: 91 }],
    ['latitude as string', { latitude: '50' }],
  ])('rejects %s', (_label, input) => {
    expect(stationPatchSchema.safeParse(input).success).toBe(false)
  })
})

describe('fieldErrorsFrom', () => {
  it('keys errors by path, and names unknown keys', () => {
    const bad = stationPatchSchema.safeParse({ label: '', nope: 1 })
    expect(bad.success).toBe(false)
    if (bad.success) return
    expect(Object.keys(fieldErrorsFrom(bad.error)).sort()).toEqual([
      'label',
      'nope',
    ])
  })
})
