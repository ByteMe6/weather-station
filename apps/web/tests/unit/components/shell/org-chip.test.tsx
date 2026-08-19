/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

import { navState } from '../../../stubs/next-navigation'

interface Membership {
  organization: { id: string; name: string }
}
const clerk: {
  isLoaded: boolean
  user: { organizationMemberships: Membership[] } | null
  orgId: string | null
} = { isLoaded: true, user: { organizationMemberships: [] }, orgId: null }

const setActive = jest.fn<Promise<void>, [unknown]>()

jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: clerk.isLoaded, user: clerk.user }),
  useAuth: () => ({ orgId: clerk.orgId, isLoaded: clerk.isLoaded }),
  useClerk: () => ({ setActive }),
}))

/**
 * Radix Select needs pointer-capture and layout APIs jsdom does not implement,
 * so the dropdown cannot be opened here. The wiring — which options exist and
 * what a choice does — is this component's own logic and is what these assert;
 * that the real control is reachable inside the drawer is an e2e concern
 * (tests/e2e/org-switch.spec.ts), because that is where the defect lived.
 */
jest.mock('@/components/ui/Select', () => ({
  Select: ({
    testId,
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    testId: string
    value: string | undefined
    onValueChange: (v: string) => void
    options: { value: string; label: string }[]
    ariaLabel: string
  }) => (
    <select
      data-testid={testId}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}))

import { OrgChip } from '@/components/shell/OrgChip'

const chip = (): ReactElement => <OrgChip testId="org" />

describe('OrgChip', () => {
  beforeEach(() => {
    setActive.mockReset()
    setActive.mockResolvedValue(undefined)
    navState.pathname = '/dashboard'
    clerk.isLoaded = true
    clerk.orgId = null
    clerk.user = { organizationMemberships: [] }
  })

  it('renders nothing until Clerk has loaded', () => {
    clerk.isLoaded = false
    render(chip())
    expect(screen.queryByTestId('org')).not.toBeInTheDocument()
  })

  it('renders nothing for a station owner who belongs to no organisation', () => {
    render(chip())
    expect(screen.queryByTestId('org')).not.toBeInTheDocument()
  })

  it('offers the personal account alongside every organisation', () => {
    clerk.user = {
      organizationMemberships: [
        { organization: { id: 'org_admin', name: 'MRPL IT' } },
      ],
    }
    render(chip())
    expect(
      Array.from(
        screen.getByTestId('org-select').querySelectorAll('option'),
      ).map((o) => o.textContent),
    ).toEqual(['Personal account', 'MRPL IT'])
  })

  it('shows the active organisation, falling back to the personal account', () => {
    clerk.user = {
      organizationMemberships: [
        { organization: { id: 'org_admin', name: 'MRPL IT' } },
      ],
    }
    const { rerender } = render(chip())
    expect(screen.getByTestId('org-select')).toHaveValue('personal')

    clerk.orgId = 'org_admin'
    rerender(chip())
    expect(screen.getByTestId('org-select')).toHaveValue('org_admin')
  })

  it('activates an organisation without leaving the current page', () => {
    navState.pathname = '/devices/ws-1'
    clerk.user = {
      organizationMemberships: [
        { organization: { id: 'org_admin', name: 'MRPL IT' } },
      ],
    }
    render(chip())
    fireEvent.change(screen.getByTestId('org-select'), {
      target: { value: 'org_admin' },
    })
    // redirectUrl, not an awaited setActive plus our own navigation: Clerk
    // navigates only once the session actually carries the organisation.
    expect(setActive).toHaveBeenCalledWith({
      organization: 'org_admin',
      redirectUrl: '/devices/ws-1',
    })
  })

  it('leaves for the dashboard when the personal account is chosen', () => {
    // Inside /admin the console re-activates the admin org on mount, so staying
    // put would make the switcher visibly fight the user's own choice.
    navState.pathname = '/admin'
    clerk.orgId = 'org_admin'
    clerk.user = {
      organizationMemberships: [
        { organization: { id: 'org_admin', name: 'MRPL IT' } },
      ],
    }
    render(chip())
    fireEvent.change(screen.getByTestId('org-select'), {
      target: { value: 'personal' },
    })
    expect(setActive).toHaveBeenCalledWith({
      organization: null,
      redirectUrl: '/dashboard',
    })
  })
})
