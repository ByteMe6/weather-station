/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { maskIdentifier } from '@/components/devices/maskIdentifier'
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
  it('maskIdentifier formats the 4-char tails the RPC returns', () => {
    expect(maskIdentifier(members[0]!)).toBe('user_…3f2a')
    expect(maskIdentifier(members[1]!)).toBe('tg · …4821')
    expect(maskIdentifier({ clerkTail: null, telegramTail: null })).toBe(
      'unknown',
    )
  })

  it('memberDisplayName prefers the Clerk name, then says what kind of account it is', () => {
    expect(
      memberDisplayName(members[0]!, { name: 'Ada Lovelace', avatarUrl: null }),
    ).toBe('Ada Lovelace')
    expect(memberDisplayName(members[0]!, null)).toBe('Member')
    expect(memberDisplayName(members[1]!, null)).toBe('Telegram user')
  })

  it('renders names + avatars from profiles and falls back to masked handles', () => {
    wrap(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        profiles={{
          'u-a': { name: 'Ada Lovelace', avatarUrl: 'https://img/a' },
        }}
        viewerUserId="u-a"
        canManage
      />,
    )
    expect(screen.getByTestId('ml-row-u-a-name')).toHaveTextContent(
      'Ada Lovelace',
    )
    expect(screen.getByTestId('ml-row-u-a-handle')).toHaveTextContent(
      'user_…3f2a',
    )
    expect(screen.getByTestId('ml-row-u-a-avatar')).toBeInTheDocument()
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
