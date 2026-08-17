/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

const users: {
  data: AdminUser[] | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
} = { data: [], isLoading: false, isError: false, error: null }
jest.mock('@/services/admin/admin.queries', () => ({
  useAdminUsersQuery: () => users,
}))
const ready = { value: true }
jest.mock('@/components/admin/EnsureAdminOrgActive', () => ({
  useAdminOrgReady: () => ready.value,
}))

import { AdminUsersTable } from '@/components/admin/AdminUsersTable'
import type { AdminUser } from '@/services/admin/admin.service'

describe('AdminUsersTable', () => {
  beforeEach(() => {
    ready.value = true
    users.isLoading = false
    users.isError = false
    users.data = []
  })

  it('masks identifiers to tails and counts stations', () => {
    users.data = [
      {
        id: 'u1',
        clerkUserId: 'user_2abcDEF13f2a',
        telegramId: null,
        createdAt: '2026-08-01T00:00:00Z',
        deviceCount: 2,
      },
      {
        id: 'u2',
        clerkUserId: null,
        telegramId: 987654821,
        createdAt: '2026-08-02T00:00:00Z',
        deviceCount: 0,
      },
    ]
    render(<AdminUsersTable testId="au" />)
    expect(screen.getByTestId('au-row-u1')).toHaveTextContent('user_…3f2a')
    expect(screen.getByTestId('au-row-u1')).toHaveTextContent('2 stations')
    expect(screen.getByTestId('au-row-u2')).toHaveTextContent('tg · …4821')
    // Full identifiers must never reach the DOM.
    expect(screen.queryByText(/user_2abcDEF13f2a/)).not.toBeInTheDocument()
    expect(screen.queryByText(/987654821/)).not.toBeInTheDocument()
  })

  it('shows an error, not "no users", when the read fails', () => {
    users.isError = true
    users.error = new Error('denied')
    users.data = undefined
    render(<AdminUsersTable testId="au" />)
    expect(screen.getByTestId('au-error')).toBeInTheDocument()
    expect(screen.queryByTestId('au-empty')).not.toBeInTheDocument()
  })

  it('shows a skeleton until the admin org is active', () => {
    ready.value = false
    render(<AdminUsersTable testId="au" />)
    expect(screen.getByTestId('au-skeleton')).toBeInTheDocument()
  })
})
