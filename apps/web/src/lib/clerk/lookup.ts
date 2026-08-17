import 'server-only'

import { clerkClient } from '@clerk/nextjs/server'

/**
 * Clerk user id for a sign-in email, or null when we cannot name exactly one
 * account (MRP-38). Emails live only in Clerk — never in Postgres — so this is
 * the one way to turn what an owner types into an identity we can grant on.
 *
 * Two deliberate refusals, both resolving to null:
 *  - the address is not *verified* on the account it is attached to. Clerk lets
 *    anyone add an unverified address, so without this an attacker could attach
 *    a stranger's address to their own account and be handed the station the
 *    owner meant for that stranger.
 *  - more than one account matches. We cannot tell which one the owner meant,
 *    and guessing would hand a station to the wrong person.
 */
export const findClerkUserIdByEmail = async (
  email: string,
): Promise<string | null> => {
  const wanted = email.trim().toLowerCase()
  const client = await clerkClient()
  // limit 2 — we only need to know whether the match is ambiguous.
  const { data } = await client.users.getUserList({
    emailAddress: [wanted],
    limit: 2,
  })
  if (data.length !== 1) return null

  const user = data[0]!
  const verified = user.emailAddresses.some(
    (address) =>
      address.emailAddress.toLowerCase() === wanted &&
      address.verification?.status === 'verified',
  )
  return verified ? user.id : null
}
