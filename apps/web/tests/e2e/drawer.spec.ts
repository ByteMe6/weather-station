import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import {
  expectIconsCentred,
  expectNothingClipped,
  expectTapTargets,
} from './helpers/layout'

/**
 * The drawer has no URL of its own, so the route matrix never opens it — and
 * every control inside it went unmeasured. It shipped with a 24×24 close button
 * and 36px-tall nav links, below the 44px floor the same suite enforces on
 * every route, on the one surface that is only ever used with a thumb.
 */

/** The sheet slides in on a spring; measuring mid-flight reads a position
 *  the user never sees. Settled means the transform is back to identity. */
const openDrawer = async (page: Page): Promise<void> => {
  await page.getByTestId('app-shell-nav-menu').click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="app-shell-nav-mobile"]')
    if (!el) return false
    const t = getComputedStyle(el).transform
    return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'
  })
}

test('the open drawer has thumb-sized controls', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await openDrawer(page)
  await expectTapTargets(page)
  await expectIconsCentred(page)
})

test('the open drawer fits the viewport', async ({ page }) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await openDrawer(page)
  await expectNothingClipped(page)
})

test('every control in the drawer is reachable by a thumb', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await openDrawer(page)

  // Measured against the drawer alone, so a failure names the drawer rather
  // than whatever else the page happens to render.
  const small = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="app-shell-nav-mobile"]')
    if (!sheet) return [{ testId: 'app-shell-nav-mobile', w: 0, h: 0 }]
    return Array.from(
      sheet.querySelectorAll<HTMLElement>('button, a, input, select'),
    )
      .map((el) => {
        const r = el.getBoundingClientRect()
        return {
          testId:
            el.dataset.testid ?? (el.textContent ?? '').trim().slice(0, 24),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        }
      })
      .filter((m) => m.w > 0 && m.h > 0 && (m.w < 43 || m.h < 43))
  })
  expect(
    small,
    `drawer controls smaller than 44px:\n${small
      .map((s) => `  [${s.testId}] ${s.w}×${s.h}`)
      .join('\n')}`,
  ).toEqual([])
})
