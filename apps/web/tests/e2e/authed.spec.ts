import { expect, test } from '@playwright/test'

test('the dashboard is reachable when signed in', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(
    page.getByRole('link', { name: 'Weather Station' }),
  ).toBeVisible()
})
