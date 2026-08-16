/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { maskIdentifier } from '@/components/devices/maskIdentifier'
import { MembersList } from '@/components/devices/MembersList'
import type { DeviceMember } from '@/services/devices/devices.service'

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))
jest.mock('@/actions/devices.action', () => ({
  updateMemberRoleAction: jest.fn(),
  removeMemberAction: jest.fn(),
}))

const members: DeviceMember[] = [
  {
    deviceId: 'ws-1',
    userId: 'u-a',
    role: 'owner',
    addedAt: '2026-08-01T00:00:00Z',
    user: { clerkUserId: 'user_2abcDEF13f2a', telegramId: null },
  },
  {
    deviceId: 'ws-1',
    userId: 'u-b',
    role: 'viewer',
    addedAt: '2026-08-02T00:00:00Z',
    user: { clerkUserId: null, telegramId: 987654821 },
  },
]

describe('sharing', () => {
  it('maskIdentifier hides most of the identifier', () => {
    expect(maskIdentifier(members[0]!.user)).toBe('user_…3f2a')
    expect(maskIdentifier(members[1]!.user)).toBe('tg · …4821')
    expect(maskIdentifier(null)).toBe('unknown')
  })

  it('owners get role selects and remove buttons; viewers get read-only rows', () => {
    const { unmount } = render(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        viewerUserId="u-a"
        canManage
      />,
    )
    expect(screen.getByTestId('ml-row-u-b-role')).toBeInTheDocument()
    expect(screen.getByTestId('ml-row-u-b-remove')).toBeInTheDocument()
    unmount()
    render(
      <MembersList
        testId="ml"
        deviceId="ws-1"
        members={members}
        viewerUserId="u-b"
        canManage={false}
      />,
    )
    expect(screen.queryByTestId('ml-row-u-a-remove')).not.toBeInTheDocument()
    expect(screen.getByTestId('ml-row-u-a')).toHaveTextContent('owner')
  })
})
