import { z } from 'zod'

/**
 * How an owner names the person to share with (MRP-38): their sign-in email,
 * or their Telegram id.
 *
 * Was a raw Clerk user id (`user_…`) — nobody could find their own, so owners
 * had no workable way to share. Email is resolved to a Clerk user id
 * server-side (`lib/clerk/lookup.ts`); it is never stored in Postgres.
 */
export type ShareIdentifier =
  { kind: 'email'; email: string } | { kind: 'telegram'; telegramId: number }

const emailSchema = z.string().email()

export const parseShareIdentifier = (raw: string): ShareIdentifier | null => {
  const v = raw.trim()
  if (/^\d{5,20}$/.test(v)) return { kind: 'telegram', telegramId: Number(v) }
  const email = emailSchema.safeParse(v)
  if (email.success) return { kind: 'email', email: email.data.toLowerCase() }
  return null
}
