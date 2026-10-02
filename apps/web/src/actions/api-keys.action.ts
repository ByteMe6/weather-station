'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import type { ApiKeyScope } from '@ws/shared'
import {
  API_KEY_EXPIRY_DAYS,
  API_KEY_MAX_ACTIVE,
  API_KEY_NAME_MAX_LENGTH,
  API_KEY_SCOPES,
} from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId } from './_helpers'
import { ensureCurrentUserAction } from './users.action'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { getApiKeyProvider } from '@/lib/api/keys'
import type { ApiKeyOwner, ApiKeySummary } from '@/lib/api/keys/provider'
import {
  apiKeyRateLimitBucket,
  deleteRateLimitBucket,
} from '@/services/api-keys/rate-limit.service'

// Server actions because creating a key mints a secret (CLAUDE.md: secrets
// and elevation go through the server path). Everything below talks to
// getApiKeyProvider(), never to a concrete provider (spec §5.1).

const EXPIRY_DAYS: readonly number[] = API_KEY_EXPIRY_DAYS

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Give the key a name')
    .max(
      API_KEY_NAME_MAX_LENGTH,
      `Keep the name to at most ${API_KEY_NAME_MAX_LENGTH} characters`,
    ),
  scope: z.enum(API_KEY_SCOPES),
  expiresInDays: z
    .number()
    .refine((d) => EXPIRY_DAYS.includes(d), 'Pick one of the offered options')
    .nullable(),
})

const revokeSchema = z.object({ keyId: z.string().min(1).max(100) })

const UNKNOWN_MSG = 'Something went wrong. Try again.'

/** null when ensureCurrentUserAction never ran — no users row means no keys. */
const resolveOwner = async (
  clerkUserId: string,
): Promise<ApiKeyOwner | null> => {
  const userId = await resolveCurrentUserId(
    createServiceRoleClient(),
    clerkUserId,
  )
  return userId ? { userId, clerkUserId } : null
}

export const createApiKeyAction = async (input: {
  name: string
  scope: ApiKeyScope
  expiresInDays: number | null
}): Promise<ActionResult<{ key: ApiKeySummary; secret: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? 'name')] ??= issue.message
    }
    return actionError(
      'INVALID_INPUT',
      'Check the highlighted fields',
      fieldErrors,
    )
  }

  const ensured = await ensureCurrentUserAction()
  if (!ensured.ok) return actionError(ensured.code, ensured.message)
  const owner: ApiKeyOwner = { userId: ensured.data.userId, clerkUserId }

  try {
    const provider = getApiKeyProvider()
    // Two concurrent creates can both pass this and land on 11; the cap keeps
    // the list sane, it is not a security boundary, so that race is accepted.
    if ((await provider.countActive(owner)) >= API_KEY_MAX_ACTIVE) {
      return actionError(
        'KEY_LIMIT',
        `You can have up to ${API_KEY_MAX_ACTIVE} active keys. Revoke one first.`,
      )
    }
    return actionOk(await provider.create(owner, parsed.data))
  } catch (err) {
    console.error('createApiKeyAction failed', err)
    return actionError('UNKNOWN', 'Could not create the key. Try again.')
  }
}

export const listApiKeysAction = async (): Promise<
  ActionResult<ApiKeySummary[]>
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  try {
    const owner = await resolveOwner(clerkUserId)
    return actionOk(owner ? await getApiKeyProvider().list(owner) : [])
  } catch (err) {
    console.error('listApiKeysAction failed', err)
    return actionError('UNKNOWN', UNKNOWN_MSG)
  }
}

export const revokeApiKeyAction = async (input: {
  keyId: string
}): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const parsed = revokeSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown key')
  try {
    const owner = await resolveOwner(clerkUserId)
    const revoked = owner
      ? await getApiKeyProvider().revoke(owner, parsed.data.keyId)
      : false
    if (!revoked) return actionError('NOT_FOUND', 'That key no longer exists')
  } catch (err) {
    console.error('revokeApiKeyAction failed', err)
    return actionError('UNKNOWN', UNKNOWN_MSG)
  }
  // Best-effort, and here rather than in the provider: providers know nothing
  // about the limiter (spec §3.2). The key is already revoked, so a failure is
  // logged, never reported — a retry would otherwise answer "not found".
  try {
    await deleteRateLimitBucket(createServiceRoleClient(), {
      bucket: apiKeyRateLimitBucket(parsed.data.keyId),
    })
  } catch (err) {
    console.error('revokeApiKeyAction: rate-limit bucket cleanup failed', err)
  }
  return actionOk(null)
}
