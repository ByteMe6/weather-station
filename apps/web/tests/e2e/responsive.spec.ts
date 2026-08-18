import { test } from '@playwright/test'

import {
  expectNoHorizontalOverflow,
  expectNothingClipped,
  expectTapTargets,
} from './helpers/layout'
import { readFixtures } from './helpers/seed'

const { deviceId } = readFixtures()

const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'devices', path: '/devices' },
  { name: 'device detail', path: `/devices/${deviceId}` },
  { name: 'device register', path: '/devices/register' },
  { name: 'alerts', path: '/alerts' },
  { name: 'settings', path: '/settings' },
  { name: 'admin fleet', path: '/admin', admin: true },
  { name: 'admin users', path: '/admin/users', admin: true },
  { name: 'api reference', path: '/reference' },
]

/**
 * Routes that must be checked signed OUT. Visiting /sign-in with a session
 * redirects to the dashboard, so testing it from the shared storage state
 * measures the dashboard twice and never looks at Clerk's form at all.
 */
const PUBLIC_ROUTES = [
  { name: 'privacy', path: '/privacy' },
  { name: 'sign in', path: '/sign-in' },
]

for (const route of ROUTES) {
  test(`${route.name} fits the viewport`, async ({ page }) => {
    await page.goto(route.path)
    // An admin route 404s for a non-admin (refusals are 404, never 403), and
    // that is a fixture gap, not a layout regression. Skipping keeps the two
    // distinguishable — a red here always means a real mobile defect.
    if (route.admin && !page.url().includes('/admin')) {
      test.skip(true, 'E2E_CLERK_USER_EMAIL is not a member of ADMIN_ORG_ID')
    }
    // Motion entry animations transform elements; measuring mid-flight reads a
    // position the user never sees. Wait for the page to settle.
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectNoHorizontalOverflow(page)
    await expectNothingClipped(page)
  })

  test(`${route.name} has thumb-sized controls`, async ({ page }) => {
    // /reference is Scalar's embedded UI. We do not own its markup, and
    // patching a vendor's controls from outside would break on every upgrade.
    test.skip(
      route.name === 'api reference',
      "Scalar's own UI — not ours to size",
    )
    await page.goto(route.path)
    if (route.admin && !page.url().includes('/admin')) {
      test.skip(true, 'E2E_CLERK_USER_EMAIL is not a member of ADMIN_ORG_ID')
    }
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectTapTargets(page)
  })
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} fits the viewport`, async ({ page }) => {
      await page.goto(route.path)
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.getAnimations().map((a) => a.finished))
      await expectNoHorizontalOverflow(page)
      await expectNothingClipped(page)
    })
  }
})
