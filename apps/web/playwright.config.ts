import { defineConfig, devices } from '@playwright/test'

import { AUTH_FILE } from './tests/e2e/helpers/paths'

const PORT = 3001
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // Layout assertions are measurements; parallel workers competing for CPU
  // make animation settling flaky. Serial is fast enough for ~20 checks.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'list' : 'html',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    // clerkSetup() must run as a project dependency, never a function-based
    // globalSetup: that runs in its own process, so CLERK_FAPI and
    // CLERK_TESTING_TOKEN never reach the workers.
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `yarn dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
