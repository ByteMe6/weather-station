'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'

/**
 * Guarantees a `users` row for the signed-in Clerk user (PRD D1, MRP-19).
 * Lazy creation (not a webhook): runs from the (app) layout gate before any
 * RLS query, so previews need no webhook config. Idempotent.
 */
export const ensureCurrentUserAction = async (): Promise<
  ActionResult<{ userId: string }>
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('users')
    .upsert(
      { clerk_user_id: clerkUserId },
      { onConflict: 'clerk_user_id', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error || !data) {
    console.error('ensureCurrentUserAction failed', error)
    return actionError('UNKNOWN', 'Could not prepare your account. Try again.')
  }
  return actionOk({ userId: data.id })
}
