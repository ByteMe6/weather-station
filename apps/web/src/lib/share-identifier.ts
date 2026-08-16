/** How an owner names the person to share with (MRP-38): Clerk user id or Telegram id. */
export type ShareIdentifier =
  | { kind: 'clerk'; clerkUserId: string }
  | { kind: 'telegram'; telegramId: number }

export const parseShareIdentifier = (raw: string): ShareIdentifier | null => {
  const v = raw.trim()
  if (/^\d{5,20}$/.test(v)) return { kind: 'telegram', telegramId: Number(v) }
  if (/^user_[A-Za-z0-9]{10,}$/.test(v))
    return { kind: 'clerk', clerkUserId: v }
  return null
}
