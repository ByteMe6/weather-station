import type { DeviceMember } from '@/services/devices/devices.service'

/** Never show a full Clerk/Telegram id in the UI — just enough to recognise a person. */
export const maskIdentifier = (user: DeviceMember['user']): string => {
  if (user?.clerkUserId) return `user_…${user.clerkUserId.slice(-4)}`
  if (user?.telegramId) return `tg · …${String(user.telegramId).slice(-4)}`
  return 'unknown'
}
