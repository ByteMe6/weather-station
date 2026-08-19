'use client'

import { useAuth, useClerk, useUser } from '@clerk/nextjs'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback, useMemo } from 'react'

import { Select } from '@/components/ui/Select'

/** Sentinel for "no organisation" — Radix Select has no concept of a null value. */
const PERSONAL = 'personal'

/**
 * Organisation switcher for the mobile drawer, built on Clerk's headless API
 * rather than its `<OrganizationSwitcher>` component.
 *
 * The drawer is a modal Radix dialog, and Clerk renders its popover in its own
 * portal at `document.body` — outside the dialog. Radix's modal layer sets
 * `body { pointer-events: none }`, so that popover opened but was inert: taps
 * fell through onto the drawer behind it, and the pointerdown Radix read as
 * "outside" dismissed the sheet. Two symptoms, one cause — a foreign portal
 * cannot cohabit a modal dialog.
 *
 * `Select` is Radix, so it registers as a nested dismissable layer and stays
 * interactive inside the sheet, exactly as the station chip already does.
 * The top bar keeps Clerk's own switcher at `lg`, where no dialog contains it.
 */
export const OrgChip = ({
  testId,
  className,
}: {
  testId: string
  /** Visibility/display classes from whichever layout is rendering this. */
  className?: string
}): ReactElement | null => {
  const { user, isLoaded } = useUser()
  const { orgId } = useAuth()
  const { setActive } = useClerk()
  const pathname = usePathname()

  const memberships = useMemo(() => user?.organizationMemberships ?? [], [user])
  const options = useMemo(
    () => [
      { value: PERSONAL, label: 'Personal account' },
      ...memberships.map((m) => ({
        value: m.organization.id,
        label: m.organization.name,
      })),
    ],
    [memberships],
  )

  const onValueChange = useCallback(
    (value: string) => {
      // `redirectUrl` rather than awaiting and navigating ourselves: Clerk
      // navigates only once the session actually carries the organisation.
      // Doing it by hand raced the session sync and left every later token with
      // `org_id: null` (see ActivateAdminOrg, found in browser verification).
      //
      // Leaving for the personal account leaves for the dashboard: inside
      // /admin the console re-activates the admin org on mount, so staying put
      // would make the switcher visibly fight the user's own choice.
      void setActive({
        organization: value === PERSONAL ? null : value,
        redirectUrl: value === PERSONAL ? '/dashboard' : pathname,
      }).catch((err: unknown) => {
        console.error('OrgChip: setActive failed', err)
      })
    },
    [pathname, setActive],
  )

  // Organisations exist in this product for exactly one reason — the fleet-admin
  // org behind /admin — so a station owner is never offered the concept.
  if (!isLoaded || memberships.length === 0) return null

  return (
    <span data-testid={testId} className={className}>
      <Select
        testId={`${testId}-select`}
        ariaLabel="Organisation"
        value={orgId ?? PERSONAL}
        onValueChange={onValueChange}
        options={options}
      />
    </span>
  )
}
