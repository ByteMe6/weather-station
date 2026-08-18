import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Sub-pixel rounding means an exact comparison flaps; 1 px is not a bug. */
const TOLERANCE = 1

/**
 * Dev-only chrome injected into the page — TanStack Query's devtools panel and
 * Next.js's dev overlay. Neither ships to production and neither is ours to
 * lay out, so measuring them reports failures nobody can act on.
 */
const DEV_TOOLING = '.tsqd-parent-container, nextjs-portal, [data-nextjs-toast]'

/** The viewport-wide symptom: the page itself scrolls sideways. */
export const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(
    scrollWidth,
    `page scrolls sideways: content ${scrollWidth}px in a ${clientWidth}px viewport`,
  ).toBeLessThanOrEqual(clientWidth + TOLERANCE)
}

/**
 * The symptom `expectNoHorizontalOverflow` misses: a squeezed row inside an
 * `overflow-hidden` ancestor is clipped without ever producing a scrollbar.
 * Containers that legitimately scroll sideways opt out with
 * `data-allow-x-scroll`.
 */
export const expectNothingClipped = async (page: Page): Promise<void> => {
  const offenders = await page.evaluate((devTooling) => {
    const limit = document.documentElement.clientWidth
    const out: { tag: string; testId: string; right: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('[data-allow-x-scroll]')) continue
      if (el.closest(devTooling)) continue
      // An <svg> child's rect is not independently meaningful — it is clipped
      // by the svg viewport, so an icon's internal <g> can report past the
      // edge while the icon itself sits comfortably inside. Measure the <svg>.
      if (el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right > limit + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          testId: el.dataset.testid ?? '',
          right: Math.round(rect.right),
        })
      }
    }
    // Ten is plenty to act on; a clipped parent drags every child in with it.
    return out.slice(0, 10)
  }, DEV_TOOLING)
  expect(
    offenders,
    `elements cross the right edge:\n${offenders
      .map(
        (o) =>
          `  ${o.tag}${o.testId ? `[${o.testId}]` : ''} right=${o.right}px`,
      )
      .join('\n')}`,
  ).toEqual([])
}

const MIN_TAP = 44

/**
 * Controls only. Links inside prose are text — padding them to 44 px would
 * wreck the paragraph — so only control-styled links are measured.
 */
export const expectTapTargets = async (page: Page): Promise<void> => {
  const small = await page.evaluate(
    ({ min, devTooling }) => {
      const sel = 'button, input, select, [role="button"], a.rounded-control'
      const out: { tag: string; testId: string; w: number; h: number }[] = []
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (el.closest(devTooling)) continue
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) continue
        // Same sub-pixel tolerance as the overflow checks: a 44px control can
        // measure 43.996 after layout, and reporting that while printing "44"
        // is maddening to debug.
        if (rect.width < min - 1 || rect.height < min - 1) {
          out.push({
            tag: el.tagName.toLowerCase(),
            testId: el.dataset.testid ?? '',
            w: Math.round(rect.width * 10) / 10,
            h: Math.round(rect.height * 10) / 10,
          })
        }
      }
      return out
    },
    { min: MIN_TAP, devTooling: DEV_TOOLING },
  )
  expect(
    small,
    `controls smaller than ${MIN_TAP}px:\n${small
      .map((s) => `  ${s.tag}${s.testId ? `[${s.testId}]` : ''} ${s.w}×${s.h}`)
      .join('\n')}`,
  ).toEqual([])
}
