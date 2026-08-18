import { test } from '@playwright/test'

import {
  expectNoHorizontalOverflow,
  expectNothingClipped,
} from './helpers/layout'
import { readFixtures } from './helpers/seed'

const { deviceId } = readFixtures()

// Dialogs have no URL of their own, so the route matrix never sees them.
// testIds verified against source: DashboardView is testId="dashboard",
// DeviceDetail is testId="device", AlertsView is testId="alerts".
const DIALOGS = [
  { name: 'export csv', path: '/dashboard', trigger: 'dashboard-export' },
  {
    name: 'share access',
    path: `/devices/${deviceId}`,
    trigger: 'device-share',
  },
  {
    name: 'device profile',
    path: `/devices/${deviceId}`,
    trigger: 'device-edit',
  },
  { name: 'schedule', path: '/alerts', trigger: 'alerts-add' },
]

for (const dialog of DIALOGS) {
  test(`${dialog.name} dialog fits the viewport`, async ({ page }) => {
    await page.goto(dialog.path)
    await page.waitForLoadState('networkidle')
    await page.getByTestId(dialog.trigger).click()
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectNoHorizontalOverflow(page)
    await expectNothingClipped(page)
  })
}
