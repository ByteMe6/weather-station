/**
 * Contract constants for the key-authenticated station API (/api/v1/stations,
 * docs/superpowers/specs/2026-10-01-public-read-api-design.md). Shared so the
 * route handlers, the server actions and the Settings UI cannot disagree.
 */

/** `read` keys may call every GET; PATCH needs `read_write`. Mirrors the api_keys.scope check constraint. */
export const API_KEY_SCOPES = ['read', 'read_write'] as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]

/** A `read_write` key satisfies `read`; only `read_write` satisfies `read_write`. */
export const scopeAllows = (
  granted: ApiKeyScope,
  required: ApiKeyScope,
): boolean => required === 'read' || granted === 'read_write'

/** Expiry choices offered at creation; `null` (never) is offered alongside. */
export const API_KEY_EXPIRY_DAYS = [30, 90, 365] as const

export type ApiKeyExpiryDays = (typeof API_KEY_EXPIRY_DAYS)[number]

export const API_KEY_DEFAULT_EXPIRY_DAYS: ApiKeyExpiryDays = 90

/** Active (not revoked, not expired) keys per user. */
export const API_KEY_MAX_ACTIVE = 10

export const API_KEY_NAME_MAX_LENGTH = 60

/** Fixed-window limit per key, enforced by api_rate_limit_hit(). */
export const API_RATE_LIMIT = { limit: 60, windowSeconds: 60 } as const

export const API_READINGS_PAGE_DEFAULT = 288
/** PostgREST max_rows — a larger page would be truncated without an error. */
export const API_READINGS_PAGE_MAX = 1000
export const API_READINGS_DEFAULT_SPAN_MS = 24 * 3_600_000
export const API_READINGS_MAX_SPAN_MS = 31 * 86_400_000

export const API_AGGREGATE_INTERVALS = ['15m', '1h', '6h', '1d'] as const

export type ApiAggregateInterval = (typeof API_AGGREGATE_INTERVALS)[number]

/** Bucket width in minutes; readings_bucketed() accepts 1..1440. */
export const API_AGGREGATE_INTERVAL_MINUTES: Record<
  ApiAggregateInterval,
  number
> = { '15m': 15, '1h': 60, '6h': 360, '1d': 1440 }

export const API_AGGREGATE_DEFAULT_INTERVAL: ApiAggregateInterval = '1h'
export const API_AGGREGATE_DEFAULT_SPAN_MS = 7 * 86_400_000
export const API_AGGREGATE_MAX_BUCKETS = 1000
// Long spans aggregate raw readings; revisit when readings_daily (deferred, init_schema) lands.
export const API_AGGREGATE_MAX_SPAN_MS = 366 * 86_400_000

/**
 * Longest window an aggregate request may span at `interval`.
 * readings_bucketed() bins from `from` and includes `timestamp <= to`, so a
 * span of exactly N x interval yields bucket indexes 0..N — N + 1 rows. The
 * cap is therefore (MAX_BUCKETS - 1) x interval, or PostgREST's max_rows
 * (1000) would silently drop the last bucket.
 */
export const aggregateMaxSpanMs = (interval: ApiAggregateInterval): number =>
  Math.min(
    API_AGGREGATE_MAX_SPAN_MS,
    (API_AGGREGATE_MAX_BUCKETS - 1) *
      API_AGGREGATE_INTERVAL_MINUTES[interval] *
      60_000,
  )
