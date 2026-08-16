import type { DeviceMember } from '@/services/devices/devices.service'

/**
 * A recognisable handle for a member. The `device_members` RPC already
 * minimises what leaves the DB (4-char tails only), so this only formats.
 */
export const maskIdentifier = (
  member: Pick<DeviceMember, 'clerkTail' | 'telegramTail'>,
): string => {
  if (member.clerkTail) return `user_…${member.clerkTail}`
  if (member.telegramTail) return `tg · …${member.telegramTail}`
  return 'unknown'
}
