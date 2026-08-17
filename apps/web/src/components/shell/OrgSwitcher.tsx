'use client'

import { OrganizationSwitcher, useUser } from '@clerk/nextjs'
import type { ReactElement } from 'react'

/**
 * Organisation switcher, shown only to people who actually belong to one.
 *
 * Organisations exist in this product for exactly one reason — the fleet-admin
 * org behind /admin — so rendering a switcher (and its "Create organisation"
 * affordance) for every station owner would offer a concept they have no use
 * for.
 *
 * Selecting the personal account leaves for the dashboard: inside /admin the
 * console re-activates the admin org on mount, so staying put would make the
 * switcher visibly fight the user's own choice.
 */
export const OrgSwitcher = ({
  testId,
}: {
  testId: string
}): ReactElement | null => {
  const { user, isLoaded } = useUser()
  if (!isLoaded || (user?.organizationMemberships?.length ?? 0) === 0) {
    return null
  }
  return (
    <span data-testid={testId} className="hidden md:inline-flex">
      <OrganizationSwitcher
        afterSelectPersonalUrl="/dashboard"
        skipInvitationScreen
        appearance={{
          elements: {
            organizationSwitcherTrigger:
              'rounded-control border border-line px-2 py-1 text-sm',
          },
        }}
      />
    </span>
  )
}
