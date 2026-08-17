import 'server-only'

import { auth, clerkClient } from '@clerk/nextjs/server'
import { cache } from 'react'

import { isAdminOrg } from './org'

/**
 * Server-side admin check, used by the console layout and every admin action.
 *
 * Two paths on purpose. The session's ACTIVE organisation is the cheap one, but
 * it cannot be the only one: Clerk's `__session` cookie — the token the server
 * reads — does not always carry `org_id` even when the client's own token does
 * (verified in the browser: the client token had the organisation while the
 * cookie's `org_id` stayed null across refreshes). Relying on the cookie alone
 * makes a genuine admin's actions fail with NOT_FOUND, so membership of the
 * admin organisation — authoritative, straight from Clerk's API — decides.
 *
 * RLS is unaffected: the browser's Supabase client uses the client token, which
 * does carry `org_id`, which is what `public.is_admin_request()` compares.
 */
export const isAdminRequest = cache(async (): Promise<boolean> => {
  const { userId, orgId } = await auth()
  if (!userId) return false
  if (isAdminOrg(orgId)) return true

  const configured = process.env.ADMIN_ORG_ID?.trim()
  if (!configured) return false
  try {
    const client = await clerkClient()
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
      limit: 100,
    })
    return memberships.data.some((m) => m.organization.id === configured)
  } catch (err) {
    console.error('isAdminRequest: membership lookup failed', err)
    return false
  }
  // `cache` dedupes within one request: the layout and every action called
  // during that render share a single Clerk round-trip instead of one each.
})
