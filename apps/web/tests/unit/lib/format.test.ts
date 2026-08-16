import { bearingToCompass, formatRelative, readingAgeMs } from '@/lib/format'

describe('format', () => {
  it('maps bearings to 16-point compass', () => {
    expect(bearingToCompass(0)).toBe('N')
    expect(bearingToCompass(315)).toBe('NW')
    expect(bearingToCompass(348.75)).toBe('N')
    expect(bearingToCompass(101)).toBe('E')
  })
  it('formats relative time', () => {
    const now = new Date('2026-08-15T12:37:00Z')
    expect(formatRelative('2026-08-15T12:36:40Z', now)).toBe('just now')
    expect(formatRelative('2026-08-15T12:35:00Z', now)).toBe('2 min ago')
    expect(formatRelative('2026-08-15T10:35:00Z', now)).toBe('2 h ago')
    expect(readingAgeMs('2026-08-15T12:35:00Z', now)).toBe(120_000)
  })
})
