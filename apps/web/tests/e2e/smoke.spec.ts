import { expect, test } from '@playwright/test'

test('the privacy page renders at this viewport', async ({ page }) => {
  await page.goto('/privacy')
  await expect(
    page.getByRole('heading', { name: 'What we collect' }),
  ).toBeVisible()
})
