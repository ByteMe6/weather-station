import 'server-only'

import type { ApiKeyScope } from '@ws/shared'
import { API_RATE_LIMIT, scopeAllows } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'

import { parseBearer } from './bearer'
import { getApiKeyProvider } from './keys'
import type { ResponseMeta } from './respond'
import { apiError, withMeta } from './respond'

import {
  apiKeyRateLimitBucket,
  hitRateLimit,
} from '@/services/api-keys/rate-limit.service'
import { ServiceError } from '@/services/database/types'

type Service = ReturnType<typeof createServiceRoleClient>

/** What a station route handler gets once the key has been accepted. */
export interface ApiContext {
  /** Service-role client — RLS is bypassed, so every query must be scoped in code. */
  service: Service
  /** Internal users.id of the key's owner. */
  userId: string
  keyId: string
  scope: ApiKeyScope
  meta: ResponseMeta
}

type RouteContext<P> = { params: Promise<P> }

export type ApiHandler<P> = (
  req: Request,
  ctx: ApiContext,
  params: P,
) => Promise<Response>

interface ApiKeyRouteOptions {
  scope: ApiKeyScope
  cors: boolean
}

const wrapped = new WeakMap<object, ApiKeyRouteOptions>()

/**
 * The options a handler was wrapped with, or undefined if it was not wrapped —
 * the route registry test uses this to prove every station handler is wrapped.
 */
export const apiKeyHandlerOptions = (
  fn: unknown,
): ApiKeyRouteOptions | undefined =>
  typeof fn === 'function' ? wrapped.get(fn) : undefined

const logFailure = (req: Request, err: unknown): void => {
  // ServiceError carries the Postgres code/details that identify the fault;
  // the response stays bare. The token is never logged.
  const cause =
    err instanceof ServiceError
      ? { message: err.message, code: err.code, details: err.details }
      : { message: err instanceof Error ? err.message : String(err) }
  console.error(
    `[api] ${req.method} ${new URL(req.url).pathname} failed`,
    cause,
  )
}

/**
 * The only entry point for station routes (spec §5–6): bearer → provider →
 * rate limit → scope, then the handler. Order matters: an over-limit key gets
 * 429 before its scope is judged, and a refused scope still counts against
 * the limit. Never imports a concrete provider — only getApiKeyProvider().
 */
export const withApiKey = <
  P extends Record<string, string> = Record<string, string>,
>(
  options: { scope: ApiKeyScope; cors: boolean },
  handler: ApiHandler<P>,
) => {
  const route = async (
    req: Request,
    routeCtx: RouteContext<P>,
  ): Promise<Response> => {
    const baseMeta: ResponseMeta = { cors: options.cors }
    // Reassigned once the limiter has answered, so a later failure still
    // reports the key's RateLimit state.
    let meta: ResponseMeta = baseMeta
    try {
      const token = parseBearer(req.headers.get('authorization'))
      if (!token) return apiError('UNAUTHORIZED', baseMeta)

      const principal = await getApiKeyProvider().authenticate(token)
      if (!principal) return apiError('UNAUTHORIZED', baseMeta)

      const service = createServiceRoleClient()
      const limit = await hitRateLimit(service, {
        bucket: apiKeyRateLimitBucket(principal.keyId),
        limit: API_RATE_LIMIT.limit,
        windowSeconds: API_RATE_LIMIT.windowSeconds,
      })
      meta = {
        cors: options.cors,
        rateLimit: {
          limit: API_RATE_LIMIT.limit,
          remaining: limit.remaining,
          resetAt: limit.resetAt,
        },
      }
      if (!limit.allowed) return apiError('RATE_LIMITED', meta)
      if (!scopeAllows(principal.scope, options.scope)) {
        return apiError('INSUFFICIENT_SCOPE', meta)
      }

      const result = await handler(
        req,
        {
          service,
          userId: principal.userId,
          keyId: principal.keyId,
          scope: principal.scope,
          meta,
        },
        await routeCtx.params,
      )
      return withMeta(result, meta)
    } catch (err) {
      logFailure(req, err)
      return apiError('INTERNAL', meta)
    }
  }
  wrapped.set(route, { scope: options.scope, cors: options.cors })
  return route
}
