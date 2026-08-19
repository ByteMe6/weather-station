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
 *
 * TOP BAR ONLY. Clerk renders the popover in its own portal at `document.body`,
 * so inside a modal dialog it lands outside the layer that Radix leaves
 * interactive and goes inert. The mobile drawer uses `OrgChip` instead.
 */
export const OrgSwitcher = ({
  testId,
  className,
}: {
  testId: string
  /** Visibility/display classes from whichever layout is rendering this. */
  className?: string
}): ReactElement | null => {
  const { user, isLoaded } = useUser()
  if (!isLoaded || (user?.organizationMemberships?.length ?? 0) === 0) {
    return null
  }
  return (
    <span data-testid={testId} className={className}>
      <OrganizationSwitcher
        afterSelectPersonalUrl="/dashboard"
        skipInvitationScreen
        appearance={{
          elements: {
            organizationSwitcherTrigger:
              'rounded-control border border-line px-2 py-1 text-sm max-lg:min-h-11',
          },
        }}
      />
    </span>
  )
}
