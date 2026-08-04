import { parseReadingPayload } from '@/lib/ingest/reading-schema'

const valid = {
  timestamp: '2026-07-21T12:00:00.000Z',
  temperature: 21.4,
  humidity: 55,
  pressure: 1013.2,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
}

describe('parseReadingPayload', () => {
  it('accepts a valid payload', () => {
    const result = parseReadingPayload(valid)
    expect(result.ok).toBe(true)
  })

  it('accepts null for optional sensor fields', () => {
    const result = parseReadingPayload({
      ...valid,
      windSpeed: null,
      precipitation: null,
    })
    expect(result.ok).toBe(true)
  })

  it('accepts populated optional sensor fields within range', () => {
    const result = parseReadingPayload({
      ...valid,
      windSpeed: 12,
      windDirection: 180,
      precipitation: 3,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects out-of-range temperature', () => {
    const result = parseReadingPayload({ ...valid, temperature: 999 })
    expect(result.ok).toBe(false)
  })

  it('rejects out-of-range humidity', () => {
    const result = parseReadingPayload({ ...valid, humidity: 150 })
    expect(result.ok).toBe(false)
  })

  it('accepts a null humidity from a device without a humidity sensor', () => {
    const result = parseReadingPayload({ ...valid, humidity: null })
    expect(result.ok).toBe(true)
  })

  it('rejects a missing required field', () => {
    const missing: Record<string, unknown> = { ...valid }
    delete missing.temperature
    const result = parseReadingPayload(missing)
    expect(result.ok).toBe(false)
  })

  it('rejects a wrong-typed field', () => {
    const result = parseReadingPayload({ ...valid, temperature: 'hot' })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-ISO timestamp', () => {
    const result = parseReadingPayload({ ...valid, timestamp: 'yesterday' })
    expect(result.ok).toBe(false)
  })

  it('strips unknown extra fields', () => {
    const result = parseReadingPayload({ ...valid, extra: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) expect('extra' in result.data).toBe(false)
  })
})
