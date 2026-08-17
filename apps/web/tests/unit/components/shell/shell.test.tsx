/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import type React from 'react'

import { navState } from '../../../stubs/next-navigation'

interface UserButtonMock {
  ({ children }: { children?: React.ReactNode }): React.ReactElement
  MenuItems: ({
    children,
  }: {
    children?: React.ReactNode
  }) => React.ReactElement
  Link: (p: { href: string; label: string }) => React.ReactElement
}
const UserButtonMock = (({ children }) => (
  <div data-testid="user-button">{children}</div>
)) as UserButtonMock
const MenuItemsMock = ({ children }: { children?: React.ReactNode }) => (
  <div>{children}</div>
)
MenuItemsMock.displayName = 'UserButton.MenuItems'
const MenuLinkMock = ({ href, label }: { href: string; label: string }) => (
  <a data-testid={`user-menu-link-${href}`} href={href}>
    {label}
  </a>
)
MenuLinkMock.displayName = 'UserButton.Link'
UserButtonMock.MenuItems = MenuItemsMock
UserButtonMock.Link = MenuLinkMock
const clerkUser: {
  isLoaded: boolean
  user: { id: string; organizationMemberships: unknown[] } | null
} = {
  isLoaded: true,
  user: { id: 'user_1', organizationMemberships: [] },
}
jest.mock('@clerk/nextjs', () => ({
  UserButton: UserButtonMock,
  useUser: () => ({ ...clerkUser, isSignedIn: true }),
  OrganizationSwitcher: () => <div data-testid="clerk-org-switcher" />,
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
import type { MyDevice } from '@/services/devices/devices.service'

const device = (deviceId: string, label: string | null): MyDevice => ({
  deviceId,
  role: 'owner',
  addedAt: '2026-08-01T00:00:00Z',
  device: {
    status: 'registered',
    createdAt: '2026-08-01T00:00:00Z',
    label,
    address: null,
    latitude: null,
    longitude: null,
  },
})

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>,
  )

describe('shell', () => {
  it('TopNav marks the active item from the pathname', () => {
    navState.pathname = '/settings'
    wrap(
      <TopNav
        testId="nav"
        devices={[device('ws-1', null)]}
        selectedDeviceId="ws-1"
        onSelectDevice={jest.fn()}
        deviceLabel="ws-1"
      />,
    )
    expect(screen.getByTestId('nav-link-settings')).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByTestId('nav-link-dashboard')).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('the station chip is hidden with no stations, a label with one, a dropdown with several', () => {
    navState.pathname = '/dashboard'
    const onSelect = jest.fn()
    const { rerender } = wrap(
      <TopNav
        testId="nav"
        devices={[]}
        selectedDeviceId={null}
        onSelectDevice={onSelect}
        deviceLabel={null}
      />,
    )
    expect(screen.queryByTestId('nav-device')).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TopNav
          testId="nav"
          devices={[device('ws-1', 'Backyard')]}
          selectedDeviceId="ws-1"
          onSelectDevice={onSelect}
          deviceLabel="Backyard"
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('nav-device')).toHaveTextContent('Backyard')
    expect(screen.queryByTestId('nav-device-select')).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TopNav
          testId="nav"
          devices={[device('ws-1', 'Backyard'), device('ws-2', null)]}
          selectedDeviceId="ws-1"
          onSelectDevice={onSelect}
          deviceLabel="Backyard"
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('nav-device-select')).toBeInTheDocument()
  })

  it('shows the organisation switcher only to people who belong to one', () => {
    navState.pathname = '/dashboard'
    const props = {
      testId: 'nav',
      devices: [],
      selectedDeviceId: null,
      onSelectDevice: jest.fn(),
      deviceLabel: null,
    }
    // A station owner with no organisation gets no switcher: organisations
    // exist here only for the fleet-admin org.
    clerkUser.user = { id: 'user_1', organizationMemberships: [] }
    const { rerender } = wrap(<TopNav {...props} />)
    expect(screen.queryByTestId('nav-org')).not.toBeInTheDocument()

    clerkUser.user = {
      id: 'user_1',
      organizationMemberships: [{ organization: { id: 'org_admin' } }],
    }
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TopNav {...props} />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('nav-org')).toBeInTheDocument()
    expect(screen.getByTestId('clerk-org-switcher')).toBeInTheDocument()
  })

  it('offers the admin console in the account menu only to admins', () => {
    navState.pathname = '/dashboard'
    const { rerender } = wrap(
      <TopNav
        testId="nav"
        devices={[]}
        selectedDeviceId={null}
        onSelectDevice={jest.fn()}
        deviceLabel={null}
      />,
    )
    // Not an admin: no console entry anywhere, including the main nav.
    expect(
      screen.queryByTestId('user-menu-link-/admin'),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-link-admin')).not.toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TopNav
          testId="nav"
          devices={[]}
          selectedDeviceId={null}
          onSelectDevice={jest.fn()}
          deviceLabel={null}
          showAdmin
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('user-menu-link-/admin')).toHaveTextContent(
      'Admin console',
    )
    // It belongs in the account menu, never the primary nav.
    expect(screen.queryByTestId('nav-link-admin')).not.toBeInTheDocument()
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
