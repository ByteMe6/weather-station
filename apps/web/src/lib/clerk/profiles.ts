import 'server-only'

import { clerkClient } from '@clerk/nextjs/server'

export interface ClerkProfile {
  /** Full name, or username, or null when Clerk has neither. */
  name: string | null
  avatarUrl: string | null
  /** Primary sign-in address; null for an account Clerk holds none for. */
  email: string | null
}

// Clerk's user list filter accepts up to 100 ids per call.
const BATCH = 100

/**
 * Display data for a set of Clerk users, fetched live from Clerk's backend
 * API — names/avatars are never copied into our DB (data-minimisation review).
 * Ids Clerk does not know are simply absent from the result.
 */
export const fetchClerkProfiles = async (
  clerkUserIds: readonly string[],
): Promise<Map<string, ClerkProfile>> => {
  const out = new Map<string, ClerkProfile>()
  const ids = [...new Set(clerkUserIds)]
  if (ids.length === 0) return out
  const client = await clerkClient()
  for (let i = 0; i < ids.length; i += BATCH) {
    const { data } = await client.users.getUserList({
      userId: ids.slice(i, i + BATCH),
      limit: BATCH,
    })
    for (const u of data) {
      out.set(u.id, {
        name: u.fullName ?? u.username ?? null,
        avatarUrl: u.imageUrl || null,
        email: u.primaryEmailAddress?.emailAddress ?? null,
      })
    }
  }
  return out
}
