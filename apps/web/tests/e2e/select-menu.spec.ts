import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

import { readFixtures } from './helpers/seed'

const { deviceId } = readFixtures()

/**
 * An open dropdown has no URL of its own, so the route matrix never sees one —
 * the same blind spot that hid the dialogs and the drawer. Every `Select` in
 * the app shipped 32px options: rows a thumb picks from, a third under the
 * 44px floor the same suite enforces everywhere else.
 */

/** Same 1px tolerance `expectTapTargets` applies. */
const MIN_TAP = 43

/** Radix animates the menu open; a row measured on the way in reads short. */
const settled = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="listbox"]')
    if (!el) return false
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return Math.abs(m.a - 1) < 0.0001 && Math.abs(m.d - 1) < 0.0001
  })
}

const MENUS = [
  {
    name: 'station chip in the drawer',
    open: async (page: Page) => {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
      await page.getByTestId('app-shell-nav-menu').click()
      await page.getByTestId('app-shell-nav-mobile-device-select').click()
    },
  },
  {
    name: 'organisation chip in the drawer',
    open: async (page: Page) => {
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle')
      await page.getByTestId('app-shell-nav-menu').click()
      await page.getByTestId('app-shell-nav-mobile-org-select').click()
    },
  },
  {
    name: 'role in the share dialog',
    open: async (page: Page) => {
      await page.goto(`/devices/${deviceId}`)
      await page.waitForLoadState('networkidle')
      await page.getByTestId('device-share').click()
      await page.getByTestId('device-share-dialog-role-select').click()
    },
  },
  {
    // Twelve options — the longest menu in the app, and the one that proves a
    // taller row still leaves a menu that fits on screen.
    name: 'timezone in the schedule dialog',
    open: async (page: Page) => {
      await page.goto('/alerts')
      await page.waitForLoadState('networkidle')
      await page.getByTestId('alerts-add').click()
      await page.getByTestId('alerts-add-dialog-timezone-select').click()
    },
  },
]

for (const menu of MENUS) {
  test(`${menu.name}: options are thumb-sized`, async ({ page }) => {
    await menu.open(page)
    await settled(page)

    const small = await page.evaluate((min) => {
      const list = document.querySelector('[role="listbox"]')
      if (!list) return [{ label: 'no listbox', w: 0, h: 0 }]
      return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]'))
        .map((el) => {
          const r = el.getBoundingClientRect()
          return {
            label:
              el.dataset.testid ?? (el.textContent ?? '').trim().slice(0, 24),
            w: Math.round(r.width * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          }
        })
        .filter((m) => m.w > 0 && m.h > 0 && (m.w < min || m.h < min))
    }, MIN_TAP)

    expect(
      small,
      `dropdown options smaller than 44px:\n${small
        .map((m) => `  [${m.label}] ${m.w}×${m.h}`)
        .join('\n')}`,
    ).toEqual([])
  })

  test(`${menu.name}: the open menu fits on screen`, async ({ page }) => {
    await menu.open(page)
    await settled(page)

    // Taller rows make a long menu taller. It must stay inside the viewport
    // and scroll internally rather than run off the bottom, where the last
    // options would be unreachable.
    const fit = await page.evaluate(() => {
      const list = document.querySelector('[role="listbox"]')
      if (!list) return null
      const r = list.getBoundingClientRect()
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        viewport: window.innerHeight,
        scrolls: list.scrollHeight > list.clientHeight + 1,
      }
    })
    expect(fit, 'no listbox found').not.toBeNull()
    expect(fit!.top, 'menu starts above the viewport').toBeGreaterThanOrEqual(
      -1,
    )
    expect(fit!.bottom, 'menu runs past the bottom').toBeLessThanOrEqual(
      fit!.viewport + 1,
    )
  })
}
