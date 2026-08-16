/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

import { navState } from '../../../stubs/next-navigation'

jest.mock('@clerk/nextjs', () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: 'user_1' } }),
}))
jest.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'system',
    setTheme: jest.fn(),
    resolvedTheme: 'light',
  }),
}))
const ensure = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/users.action', () => ({
  ensureCurrentUserAction: () => ensure(),
}))

import { EnsureUser } from '@/components/shell/EnsureUser'
import { TopNav } from '@/components/shell/TopNav'

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  )

describe('shell', () => {
  it('TopNav marks the active item from the pathname', () => {
    navState.pathname = '/settings'
    wrap(<TopNav testId="nav" deviceLabel="WS-7F3A" />)
    expect(screen.getByTestId('nav-link-settings')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByTestId('nav-link-dashboard')).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('EnsureUser shows the shell skeleton until the users row exists, then children', async () => {
    let resolve: (v: unknown) => void = () => undefined
    ensure.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    wrap(
      <EnsureUser>
        <div data-testid="child" />
      </EnsureUser>,
    )
    expect(screen.getByTestId('shell-skeleton')).toBeInTheDocument()
    resolve({ ok: true, data: { userId: 'u1' } })
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument())
  })

  it('EnsureUser shows a retry state on failure', async () => {
    ensure.mockResolvedValue({
      ok: false,
      code: 'UNKNOWN',
      message: 'Could not prepare your account. Try again.',
    })
    wrap(
      <EnsureUser>
        <div data-testid="child" />
      </EnsureUser>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('ensure-user-error')).toHaveTextContent(
        'Could not prepare your account',
      ),
    )
  })
})
