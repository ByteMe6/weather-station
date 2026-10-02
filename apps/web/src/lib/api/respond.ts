import type { ApiErrorBody } from '@ws/shared'

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_SCOPE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL'

const ERRORS: Record<ApiErrorCode, { status: number; message: string }> = {
  INVALID_INPUT: { status: 400, message: 'The request is invalid' },
  // One message for missing, malformed, unknown, revoked and expired keys, so
  // a caller cannot tell which keys exist.
  UNAUTHORIZED: { status: 401, message: 'Missing or invalid API key' },
  INSUFFICIENT_SCOPE: {
    status: 403,
    message: 'This API key is read-only — create a read & write key',
  },
  FORBIDDEN: {
    status: 403,
    message: 'Your role on this station does not allow this',
  },
  // Also the answer for stations you are not a member of: whether an id
  // exists is not something a key may learn.
  NOT_FOUND: { status: 404, message: 'Station not found' },
  RATE_LIMITED: { status: 429, message: 'Too many requests for this API key' },
  INTERNAL: { status: 500, message: 'Something went wrong' },
}

export interface RateLimitState {
  limit: number
  remaining: number
  resetAt: string
}

/** What every response of one request shares: CORS policy and limiter state. */
export interface ResponseMeta {
  cors: boolean
  rateLimit?: RateLimitState
}

/**
 * GET-only CORS. Users may call the read endpoints from a small site of their
 * own; no cookies are involved (no Allow-Credentials), so there is no CSRF
 * exposure. PATCH is deliberately absent: a write key in browser JavaScript
 * would let any visitor edit the station.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization',
  'Access-Control-Expose-Headers':
    'RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After',
  'Access-Control-Max-Age': '600',
}

const secondsUntil = (iso: string): number =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 1000))

const buildHeaders = (
  meta: ResponseMeta,
  extra: Record<string, string> = {},
): Headers => {
  const headers = new Headers({ 'Cache-Control': 'no-store', ...extra })
  if (meta.cors) {
    for (const [name, value] of Object.entries(CORS_HEADERS)) {
      headers.set(name, value)
    }
  }
  if (meta.rateLimit) {
    headers.set('RateLimit-Limit', String(meta.rateLimit.limit))
    headers.set('RateLimit-Remaining', String(meta.rateLimit.remaining))
    headers.set('RateLimit-Reset', String(secondsUntil(meta.rateLimit.resetAt)))
  }
  return headers
}

export const apiJson = (
  body: unknown,
  meta: ResponseMeta,
  status = 200,
): Response => Response.json(body, { status, headers: buildHeaders(meta) })

export const apiError = (
  code: ApiErrorCode,
  meta: ResponseMeta,
  options: { message?: string; fieldErrors?: Record<string, string> } = {},
): Response => {
  const body: ApiErrorBody = {
    error: {
      code,
      message: options.message ?? ERRORS[code].message,
      ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {}),
    },
  }
  const extra: Record<string, string> =
    code === 'RATE_LIMITED' && meta.rateLimit
      ? {
          'Retry-After': String(
            Math.max(1, secondsUntil(meta.rateLimit.resetAt)),
          ),
        }
      : {}
  return Response.json(body, {
    status: ERRORS[code].status,
    headers: buildHeaders(meta, extra),
  })
}

/** OPTIONS handler for every station route — GET-only CORS. */
export const preflight = (): Response =>
  new Response(null, { status: 204, headers: buildHeaders({ cors: true }) })

/**
 * Stamps the request's shared headers (no-store, CORS, rate limit) onto a
 * response a handler built, so a handler cannot forget them. Falls back to a
 * rebuilt Response when the headers are immutable (e.g. Response.redirect).
 */
export const withMeta = (response: Response, meta: ResponseMeta): Response => {
  const stamp = buildHeaders(meta)
  try {
    stamp.forEach((value, name) => response.headers.set(name, value))
    return response
  } catch {
    const headers = new Headers(response.headers)
    stamp.forEach((value, name) => headers.set(name, value))
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
