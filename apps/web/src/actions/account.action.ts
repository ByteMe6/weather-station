'use server'

import 'server-only'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'

import { eraseUserByClerkId } from '@/lib/account/erase-user'
import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'

/** Deletes the caller's data, then their Clerk account. The client signs out afterwards. */
export const deleteAccountAction = async (input: {
  confirmation: string
}): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  if (input.confirmation.trim().toLowerCase() !== 'delete') {
    return actionError('INVALID_INPUT', 'Type "delete" to confirm', {
      confirmation: 'Type "delete" to confirm',
    })
  }

  try {
    await eraseUserByClerkId(createServiceRoleClient(), clerkUserId)
  } catch (err) {
    console.error('deleteAccountAction: erase failed', err)
    return actionError(
      'UNKNOWN',
      'Could not delete your data. Try again or contact support.',
    )
  }
  try {
    const client = await clerkClient()
    await client.users.deleteUser(clerkUserId)
  } catch (err) {
    console.error(
      'deleteAccountAction: Clerk deletion failed after DB erase',
      err,
    )
    return actionError(
      'PARTIAL',
      'Your data was deleted but the sign-in account could not be removed. Contact support to finish.',
    )
  }
  return actionOk(null)
}
