import { expect, test } from '@playwright/test'

import { expectNoHorizontalOverflow, expectNothingClipped } from './layout'

test('passes on a page that fits', async ({ page }) => {
  await page.goto('/privacy')
  await expectNoHorizontalOverflow(page)
  await expectNothingClipped(page)
})

test('catches a page that scrolls sideways', async ({ page }) => {
  await page.goto('/privacy')
  await page.evaluate(() => {
    const wide = document.createElement('div')
    wide.style.width = '3000px'
    wide.style.height = '10px'
    wide.dataset.testid = 'deliberate-overflow'
    document.body.append(wide)
  })
  await expect(expectNoHorizontalOverflow(page)).rejects.toThrow(
    /scrolls sideways/,
  )
})

test('catches an element clipped without a scrollbar', async ({ page }) => {
  await page.goto('/privacy')
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.style.overflow = 'hidden'
    box.style.width = '100px'
    box.style.maxWidth = '100px'
    const inner = document.createElement('div')
    inner.style.width = '3000px'
    inner.style.height = '10px'
    inner.dataset.testid = 'deliberate-clip'
    box.append(inner)
    document.body.append(box)
  })
  // The page does NOT scroll — this is exactly the case the first check misses.
  await expectNoHorizontalOverflow(page)
  await expect(expectNothingClipped(page)).rejects.toThrow(
    /cross the right edge/,
  )
})
