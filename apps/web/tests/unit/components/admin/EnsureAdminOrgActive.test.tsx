/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

const authState = { orgId: null as string | null, isLoaded: true }
const setActive = jest.fn<Promise<void>, [unknown]>()
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => authState,
  useClerk: () => ({ setActive }),
}))

import {
  EnsureAdminOrgActive,
  useAdminOrgReady,
} from '@/components/admin/EnsureAdminOrgActive'

const Probe = (): ReactElement => (
  <span data-testid="ready">{String(useAdminOrgReady())}</span>
)

describe('EnsureAdminOrgActive', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    authState.orgId = null
    authState.isLoaded = true
  })

  it('activates the org and reports ready once it is active', async () => {
    setActive.mockResolvedValue()
    const { rerender } = render(
      <EnsureAdminOrgActive orgId="org_admin">
        <Probe />
      </EnsureAdminOrgActive>,
    )
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith({ organization: 'org_admin' }),
    )
    // Children render throughout — unmounting them would destroy a one-time
    // secret held in a dialog's state.
    expect(screen.getByTestId('ready')).toHaveTextContent('false')

    authState.orgId = 'org_admin'
    rerender(
      <EnsureAdminOrgActive orgId="org_admin">
        <Probe />
      </EnsureAdminOrgActive>,
    )
    expect(screen.getByTestId('ready')).toHaveTextContent('true')
  })

  it('can retry after a rejected setActive instead of freezing for the session', async () => {
    setActive.mockRejectedValueOnce(new Error('clerk down'))
    const { rerender } = render(
      <EnsureAdminOrgActive orgId="org_admin">
        <Probe />
      </EnsureAdminOrgActive>,
    )
    await waitFor(() => expect(setActive).toHaveBeenCalledTimes(1))

    setActive.mockResolvedValue()
    authState.isLoaded = false
    rerender(
      <EnsureAdminOrgActive orgId="org_admin">
        <Probe />
      </EnsureAdminOrgActive>,
    )
    authState.isLoaded = true
    rerender(
      <EnsureAdminOrgActive orgId="org_admin">
        <Probe />
      </EnsureAdminOrgActive>,
    )
    await waitFor(() => expect(setActive).toHaveBeenCalledTimes(2))
  })
})
