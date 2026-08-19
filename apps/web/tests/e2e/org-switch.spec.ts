import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * Below `lg` the drawer is the ONLY way to change organisation, and the drawer
 * is a modal dialog. Anything rendered there must be reachable by a real tap.
 *
 * This shipped broken once: the drawer hosted Clerk's `<OrganizationSwitcher>`,
 * whose popover mounts in its own portal at `document.body` — outside the
 * dialog. Radix's modal layer sets `body { pointer-events: none }`, so the menu
 * opened but every tap fell through it onto the drawer behind, and the
 * pointerdown Radix saw as "outside" dismissed the sheet. The menu looked
 * present and did nothing.
 *
 * Clicking without `force` is the assertion: Playwright refuses to click an
 * element that does not receive pointer events, which is exactly the defect.
 */

const activeOrg = (page: Page): Promise<string | null> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          Clerk?: { organization?: { id: string } | null }
        }
      ).Clerk?.organization?.id ?? null,
  )

const memberships = (page: Page): Promise<string[]> =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          Clerk?: {
            user?: {
              organizationMemberships?: { organization: { id: string } }[]
            }
          }
        }
      ).Clerk?.user?.organizationMemberships?.map((m) => m.organization.id) ??
      [],
  )

const openDrawerOrgSelect = async (page: Page): Promise<void> => {
  await page.getByTestId('app-shell-nav-menu').click()
  await page.getByTestId('app-shell-nav-mobile-org-select').click()
}

test('the organisation control in the drawer actually switches organisation', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')

  const orgs = await memberships(page)
  // Same fixture gap the admin routes have: organisations exist in this product
  // only for the fleet-admin org, so a plain account has no switcher at all.
  test.skip(
    orgs.length === 0,
    'E2E_CLERK_USER_EMAIL belongs to no organisation',
  )

  const started = await activeOrg(page)
  // Idempotent whichever account the session starts on: pick the other one.
  const target = started === null ? orgs[0]! : 'personal'

  await openDrawerOrgSelect(page)
  await page
    .getByTestId(`app-shell-nav-mobile-org-select-option-${target}`)
    .click()

  await expect
    .poll(() => activeOrg(page), { timeout: 15_000 })
    .toBe(target === 'personal' ? null : target)

  // Put the session back, which also proves the switch works in both directions.
  const back = started === null ? 'personal' : started
  await openDrawerOrgSelect(page)
  await page
    .getByTestId(`app-shell-nav-mobile-org-select-option-${back}`)
    .click()
  await expect.poll(() => activeOrg(page), { timeout: 15_000 }).toBe(started)
})

test('the drawer never hosts a switcher whose menu escapes the dialog', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  test.skip(
    (await memberships(page)).length === 0,
    'E2E_CLERK_USER_EMAIL belongs to no organisation',
  )

  await page.getByTestId('app-shell-nav-menu').click()
  await page.getByTestId('app-shell-nav-mobile-org-select').click()

  // The open menu must be the thing under its own pixels. A foreign portal is
  // inert inside a modal dialog, so the hit test would return the drawer.
  const reachable = await page.evaluate(() => {
    const menu = document.querySelector('[role="listbox"], [role="menu"]')
    if (!menu) return 'no menu'
    const r = menu.getBoundingClientRect()
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
    return menu.contains(hit) ? 'reachable' : 'covered'
  })
  expect(reachable).toBe('reachable')
})

test('the organisation control in the drawer is a thumb-sized target', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  test.skip(
    (await memberships(page)).length === 0,
    'E2E_CLERK_USER_EMAIL belongs to no organisation',
  )

  await page.getByTestId('app-shell-nav-menu').click()
  const box = await page
    .getByTestId('app-shell-nav-mobile-org-select')
    .boundingBox()
  // The drawer is the only place this control exists below lg, so it is always
  // being tapped with a thumb. 44px is the same floor the route matrix applies.
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
