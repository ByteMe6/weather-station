import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

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
  {
    name: 'export csv',
    path: '/dashboard',
    trigger: 'dashboard-export',
    dialog: 'dashboard-export-dialog',
  },
  {
    name: 'share access',
    path: `/devices/${deviceId}`,
    trigger: 'device-share',
    dialog: 'device-share-dialog',
  },
  {
    // The trigger and the dialog are named differently here, so the dialog's
    // own testId is spelled out rather than derived from the trigger's.
    name: 'device profile',
    path: `/devices/${deviceId}`,
    trigger: 'device-edit',
    dialog: 'device-profile-dialog',
  },
  {
    name: 'schedule',
    path: '/alerts',
    trigger: 'alerts-add',
    dialog: 'alerts-add-dialog',
  },
]

/**
 * The dialog springs in from `scale: 0.98`, so a box measured on the way there
 * reads ~2% small — enough to fail a 44px floor on a 44px control for reasons
 * the user never sees. Settled means the scale is back to 1.
 */
const settled = async (page: Page, dialogTestId: string): Promise<void> => {
  await page.waitForFunction((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`)
    if (!el) return false
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return Math.abs(m.a - 1) < 0.0001
  }, dialogTestId)
}

/**
 * Same 1px tolerance `expectTapTargets` applies: the tail of the spring leaves
 * a 44px control measuring 43.96, and reporting that while printing "44" is
 * maddening to debug.
 */
const MIN_TAP = 43

for (const dialog of DIALOGS) {
  test(`${dialog.name} dialog fits the viewport`, async ({ page }) => {
    await page.goto(dialog.path)
    await page.waitForLoadState('networkidle')
    await page.getByTestId(dialog.trigger).click()
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectNoHorizontalOverflow(page)
    await expectNothingClipped(page)
  })

  test(`${dialog.name} dialog has thumb-sized controls`, async ({ page }) => {
    await page.goto(dialog.path)
    await page.waitForLoadState('networkidle')
    await page.getByTestId(dialog.trigger).click()
    await settled(page, dialog.dialog)

    // Scoped to the dialog so a failure names it rather than the whole page,
    // and so the route matrix's own findings are not reported twice.
    const small = await page.evaluate(
      ({ id, min }) => {
        const dlg = document.querySelector(`[data-testid="${id}"]`)
        if (!dlg) return [{ testId: id, w: 0, h: 0 }]
        const sel = 'button, input, select, textarea, [role="button"]'
        return Array.from(dlg.querySelectorAll<HTMLElement>(sel))
          .filter((el) => {
            // Radix renders a 1x1 native <select> inside a form to carry the
            // value. It is aria-hidden, so it is not offered to anyone as a
            // target and measuring it reports a defect nobody can act on.
            return !el.closest('[aria-hidden="true"]')
          })
          .map((el) => {
            const r = el.getBoundingClientRect()
            return {
              testId:
                el.dataset.testid ?? (el.textContent ?? '').trim().slice(0, 24),
              w: Math.round(r.width * 10) / 10,
              h: Math.round(r.height * 10) / 10,
            }
          })
          .filter((m) => m.w > 0 && m.h > 0 && (m.w < min || m.h < min))
      },
      { id: dialog.dialog, min: MIN_TAP },
    )
    expect(
      small,
      `dialog controls smaller than 44px:\n${small
        .map((m) => `  [${m.testId}] ${m.w}×${m.h}`)
        .join('\n')}`,
    ).toEqual([])
  })

  test(`${dialog.name} dialog has a thumb-sized close button`, async ({
    page,
  }) => {
    await page.goto(dialog.path)
    await page.waitForLoadState('networkidle')
    await page.getByTestId(dialog.trigger).click()

    // Dismissing is the one thing every dialog must offer, and on a phone the
    // X is how it is done. It shipped at 24x24 — the route matrix never sees
    // it because a dialog has no URL of its own.
    await settled(page, dialog.dialog)
    const close = page.getByTestId(`${dialog.dialog}-close`)
    const box = await close.boundingBox()
    expect(box?.width ?? 0, 'close button width').toBeGreaterThanOrEqual(
      MIN_TAP,
    )
    expect(box?.height ?? 0, 'close button height').toBeGreaterThanOrEqual(
      MIN_TAP,
    )

    // Preflight's `svg { display: block }` ignores text-align, so an icon in a
    // box wider than itself sits at the start unless the box centres it.
    const slack = await close.evaluate((el) => {
      const icon = el.firstElementChild
      if (!icon) return null
      const b = el.getBoundingClientRect()
      const i = icon.getBoundingClientRect()
      return {
        left: Math.round((i.left - b.left) * 10) / 10,
        right: Math.round((b.right - i.right) * 10) / 10,
      }
    })
    expect(
      Math.abs((slack?.left ?? 0) - (slack?.right ?? 0)),
    ).toBeLessThanOrEqual(1)
  })
}
