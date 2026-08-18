import { clerk, clerkSetup } from '@clerk/testing/playwright'
import { test as setup } from '@playwright/test'

import { AUTH_FILE } from './helpers/paths'
import { seedDevice } from './helpers/seed'

// Must run serially — the token fetch races itself otherwise.
setup.describe.configure({ mode: 'serial' })

setup('obtain a Clerk testing token', async () => {
  await clerkSetup()
})

setup('sign in and save the session', async ({ page }) => {
  const emailAddress = process.env.E2E_CLERK_USER_EMAIL
  if (!emailAddress) {
    throw new Error(
      'E2E_CLERK_USER_EMAIL is not set — run via `yarn test:e2e:secrets`, or export it.',
    )
  }
  await page.goto('/')
  await clerk.signIn({ page, emailAddress })
  await page.goto('/dashboard')
  // Proves the session is real: the shell only renders for a signed-in user.
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 })
  await page.context().storageState({ path: AUTH_FILE })

  const clerkUserId = await page.evaluate(
    () =>
      (window as unknown as { Clerk?: { user?: { id: string } } }).Clerk?.user
        ?.id ?? '',
  )
  if (!clerkUserId) throw new Error('Clerk did not expose a signed-in user id')
  await seedDevice(clerkUserId)
})
