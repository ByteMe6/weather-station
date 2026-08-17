/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { memberHandle } from '@/components/devices/memberHandle'
import {
  MembersList,
  memberDisplayName,
} from '@/components/devices/MembersList'
import type { DeviceMember } from '@/services/devices/devices.service'

jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))
jest.mock('@/actions/devices.action', () => ({
  updateMemberRoleAction: jest.fn(),
  removeMemberAction: jest.fn(),
}))
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { alt: string; 'data-testid'?: string }) => (
    <span data-testid={props['data-testid']} aria-label={props.alt} />
  ),
}))

const members: DeviceMember[] = [
  {
    userId: 'u-a',
    role: 'owner',
    addedAt: '2026-08-01T00:00:00Z',
    clerkTail: '3f2a',
    telegramTail: null,
  },
  {
    userId: 'u-b',
    role: 'viewer',
    addedAt: '2026-08-02T00:00:00Z',
    clerkTail: null,
    telegramTail: '4821',
  },
]

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  )

describe('sharing', () => {
  it('memberHandle shows the email as a subtitle under a name', () => {
    expect(
      memberHandle(members[0]!, {
        name: 'Ada Lovelace',
        avatarUrl: null,
        email: 'ada@x.com',
      }),
    ).toBe('ada@x.com')
  })

  it('memberHandle falls back to the 4-char tails when Clerk gave us no email', () => {
    expect(memberHandle(members[0]!, null)).toBe('user_…3f2a')
    expect(memberHandle(members[1]!, null)).toBe('tg · …4821')
    expect(memberHandle({ clerkTail: null, telegramTail: null }, null)).toBe(
      'unknown',
    )
  })

  it('memberHandle does not echo an email that is already the name line', () => {
    // No name, so the email is promoted to the primary line — the subtitle
    // must not repeat it.
    expect(
      memberHandle(members[0]!, {
        name: null,
        avatarUrl: null,
        email: 'ada@x.com',
      }),
    ).toBe('user_…3f2a')
  })

  it('memberDisplayName prefers the Clerk name, then the email, then the kind of account', () => {
    expect(
      memberDisplayName(members[0]!, {
        name: 'Ada Lovelace',
        avatarUrl: null,
        email: 'ada@x.com',
      }),
    ).toBe('Ada Lovelace')
    expect(
      memberDisplayName(members[0]!, {
        name: null,
        avatarUrl: null,
        email: 'ada@x.com',
      }),
    ).toBe('ada@x.com')
    expect(memberDisplayName(members[0]!, null)).toBe('Member')
    expect(memberDisplayName(members[1]!, null)).toBe('Telegram user')
  })

  it('renders the email under the name, and masked handles when there is no profile', () => {
    wrap(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        profiles={{
          'u-a': {
            name: 'Ada Lovelace',
            avatarUrl: 'https://img/a',
            email: 'ada@x.com',
          },
        }}
        viewerUserId="u-a"
        canManage
      />,
    )
    expect(screen.getByTestId('ml-row-u-a-name')).toHaveTextContent(
      'Ada Lovelace',
    )
    expect(screen.getByTestId('ml-row-u-a-handle')).toHaveTextContent(
      'ada@x.com',
    )
    expect(screen.getByTestId('ml-row-u-a-avatar')).toBeInTheDocument()
    // Telegram-only member: no Clerk account, so no email to show.
    expect(screen.getByTestId('ml-row-u-b-name')).toHaveTextContent(
      'Telegram user',
    )
    expect(screen.getByTestId('ml-row-u-b-handle')).toHaveTextContent(
      'tg · …4821',
    )
  })

  it('owners get role selects and remove buttons; viewers get read-only rows', () => {
    const { unmount } = wrap(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        profiles={undefined}
        viewerUserId="u-a"
        canManage
      />,
    )
    expect(screen.getByTestId('ml-row-u-b-role')).toBeInTheDocument()
    expect(screen.getByTestId('ml-row-u-b-remove')).toBeInTheDocument()
    unmount()
    wrap(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        profiles={{}}
        viewerUserId="u-b"
        canManage={false}
      />,
    )
    expect(screen.queryByTestId('ml-row-u-a-remove')).not.toBeInTheDocument()
    expect(screen.getByTestId('ml-row-u-a')).toHaveTextContent('owner')
  })
})
