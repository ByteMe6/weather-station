import {
  API_AGGREGATE_INTERVAL_MINUTES,
  API_AGGREGATE_INTERVALS,
  API_AGGREGATE_MAX_SPAN_MS,
  API_KEY_DEFAULT_EXPIRY_DAYS,
  API_KEY_EXPIRY_DAYS,
  API_READINGS_PAGE_DEFAULT,
  API_READINGS_PAGE_MAX,
  aggregateMaxSpanMs,
  scopeAllows,
} from '../../src/constants/public-api'

describe('public API constants', () => {
  it.each([
    ['read', 'read', true],
    ['read_write', 'read', true],
    ['read_write', 'read_write', true],
    ['read', 'read_write', false],
  ] as const)('a %s key on a %s route → %s', (granted, required, allowed) => {
    expect(scopeAllows(granted, required)).toBe(allowed)
  })

  // readings_bucketed() refuses p_bucket_minutes outside 1..1440 by returning
  // nothing, which would look like "no data" rather than an error.
  it('keeps every aggregate interval inside readings_bucketed bounds', () => {
    for (const interval of API_AGGREGATE_INTERVALS) {
      const minutes = API_AGGREGATE_INTERVAL_MINUTES[interval]
      expect(minutes).toBeGreaterThanOrEqual(1)
      expect(minutes).toBeLessThanOrEqual(1440)
    }
  })

  it('caps an aggregate span at 999 intervals (1000 buckets, upper bound inclusive) and at most 366 days', () => {
    expect(aggregateMaxSpanMs('15m')).toBe(999 * 15 * 60_000)
    expect(aggregateMaxSpanMs('1h')).toBe(999 * 60 * 60_000)
    expect(aggregateMaxSpanMs('6h')).toBe(999 * 360 * 60_000)
    expect(aggregateMaxSpanMs('1d')).toBe(API_AGGREGATE_MAX_SPAN_MS)
    expect(API_AGGREGATE_MAX_SPAN_MS).toBe(366 * 86_400_000)
  })

  // PostgREST's max_rows is 1000; a larger page is silently truncated.
  it('keeps the raw page size within PostgREST max_rows', () => {
    expect(API_READINGS_PAGE_MAX).toBeLessThanOrEqual(1000)
    expect(API_READINGS_PAGE_DEFAULT).toBeLessThanOrEqual(API_READINGS_PAGE_MAX)
  })

  it('offers the default expiry among the choices', () => {
    expect(API_KEY_EXPIRY_DAYS).toContain(API_KEY_DEFAULT_EXPIRY_DAYS)
  })
})
