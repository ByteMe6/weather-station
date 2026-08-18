import { test } from '@playwright/test'

import {
  expectNoHorizontalOverflow,
  expectNothingClipped,
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

/**
 * Every one of these fails identically — the shell is 909px wide at 768px,
 * because the OrgSwitcher joins the nav at `md` and the row stops fitting.
 * Fixed in the next commit; the annotation exists so this suite is green while
 * the defect is recorded, and Playwright errors with "expected to fail but
 * passed" the moment the fix lands, forcing the annotation off.
 */
const KNOWN_BROKEN_ON_TABLET = new Set([
  'dashboard',
  'devices',
  'device detail',
  'device register',
  'alerts',
  'settings',
  'admin fleet',
  'admin users',
])

for (const route of ROUTES) {
  test(`${route.name} fits the viewport`, async ({ page }, testInfo) => {
    if (
      testInfo.project.name === 'tablet' &&
      KNOWN_BROKEN_ON_TABLET.has(route.name)
    ) {
      test.fail(true, 'shell overflows at the md breakpoint — fixed next')
    }
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
