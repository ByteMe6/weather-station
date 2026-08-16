import Image from 'next/image'
import type { ReactElement } from 'react'

import type { ClerkProfile } from '@/lib/clerk/profiles'

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')

/** 28 px avatar: Clerk image when present, initials otherwise, a neutral disc for Telegram-only members. */
export const MemberAvatar = ({
  testId,
  profile,
}: {
  testId: string
  profile: ClerkProfile | null
}): ReactElement => {
  if (profile?.avatarUrl) {
    return (
      <Image
        data-testid={testId}
        src={profile.avatarUrl}
        alt=""
        width={28}
        height={28}
        // Clerk-hosted, already sized; skip the optimizer (no remotePatterns needed).
        unoptimized
        className="border-line size-7 rounded-full border object-cover"
      />
    )
  }
  return (
    <span
      data-testid={testId}
      aria-hidden
      className="border-line bg-paper-2 text-slate inline-flex size-7 items-center justify-center rounded-full border font-mono text-[11px] font-semibold"
    >
      {profile?.name ? initials(profile.name) : '·'}
    </span>
  )
}
