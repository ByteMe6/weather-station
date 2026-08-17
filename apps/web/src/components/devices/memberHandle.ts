import type { MemberProfiles } from '@/actions/devices.action'
import type { DeviceMember } from '@/services/devices/devices.service'

/**
 * The line under a member's name: their sign-in email when Clerk has one,
 * otherwise the masked handle.
 *
 * Emails live only in Clerk and reach the browser through
 * `getDeviceMemberProfilesAction`, which hands out other members' profiles to
 * owners alone. The `device_members` RPC still returns 4-char tails and
 * nothing more, so a member the profile fetch could not cover (Telegram-only
 * account, or Clerk being down) degrades to what it always showed.
 */
export const memberHandle = (
  member: Pick<DeviceMember, 'clerkTail' | 'telegramTail'>,
  profile: MemberProfiles[string] | null,
): string => {
  // Only a subtitle when a name owns the line above — otherwise the email is
  // already the primary line and repeating it says nothing.
  if (profile?.email && profile.name) return profile.email
  if (member.clerkTail) return `user_…${member.clerkTail}`
  if (member.telegramTail) return `tg · …${member.telegramTail}`
  return 'unknown'
}
