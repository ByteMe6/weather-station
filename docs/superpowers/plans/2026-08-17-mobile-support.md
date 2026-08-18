# Mobile Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every route works at 390 px and 768 px — nothing scrolls sideways, nothing is clipped, controls are thumb-sized — proven by a Playwright suite that keeps it that way.

**Architecture:** A Playwright suite signs in through Clerk Testing Tokens (no password anywhere), seeds its own device, and asserts layout invariants per route at two viewports. The suite lands first, with known-broken routes marked `test.fail()` so it is committable green; each fix then flips one annotation off. Fixes go shared-primitive-first — the page gutter lives in five shell files, so correcting it there fixes every route at once.

**Tech Stack:** Playwright (chromium only), `@clerk/testing`, Next.js 16, Tailwind v4 (default breakpoints), Supabase service-role client for seeding.

**Spec:** `docs/superpowers/specs/2026-08-17-mobile-support-design.md`

**Already done before this plan:** the spec's §9 CLAUDE.md amendments are
applied — the testing table has its E2E row, the script-name rule admits
`test:e2e`, and the env table lists `E2E_CLERK_USER_EMAIL`. No task repeats
them.

## Global Constraints

- **Viewports:** phone `390×844`, tablet `768×1024`. Tailwind defaults: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Do not add `--breakpoint-*` to the `@theme` block.
- **Test file naming:** E2E specs are `*.spec.ts` under `apps/web/tests/e2e/`. Never `.test.ts` — jest's `testMatch` is `<rootDir>/tests/{unit,integration}/**/*.test.{ts,tsx}` and would try to run them.
- **Script names:** only `test:unit`, `test:integration`, `test:db`, `test:e2e` (CLAUDE.md).
- **TypeScript:** no `any`, no `eslint-disable`, arrow functions only (`func-style: ["error", "expression"]`), `import type` separated from value imports.
- **Every component keeps its `testId` prop** and `data-testid` in kebab-case.
- **Secrets:** never commit a value. New var `E2E_CLERK_USER_EMAIL` goes in `.env.example` empty; real value via Infisical.
- **Run `yarn lint && yarn check-types` before every commit; `yarn format` before committing.**
- **Responsive patterns** (use these exact strings, do not invent variants):
  - page gutter: `px-4 sm:px-6`
  - row that must stack: `flex-col sm:flex-row items-start sm:items-center`
  - dialog field pair: `grid-cols-1 sm:grid-cols-2`

---

### Task 1: Playwright harness, public route only

Proves Playwright runs against this app at all, before any Clerk complexity.

**Files:**
- Modify: `apps/web/package.json` (devDependencies + scripts)
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/tests/e2e/smoke.spec.ts`
- Modify: `.gitignore` (repo root)

**Interfaces:**
- Consumes: nothing
- Produces: `yarn workspace @ws/web test:e2e` runs Playwright; projects named `phone` and `tablet` exist with viewports 390×844 and 768×1024.

- [ ] **Step 1: Install dependencies**

```bash
cd apps/web
yarn add -D @playwright/test @clerk/testing
npx playwright install chromium
```

- [ ] **Step 2: Add the gitignore entries**

Append to the repo-root `.gitignore` under the existing `# testing` block:

```gitignore
# playwright (auth state contains a live session — never commit)
apps/web/playwright/.clerk/
apps/web/test-results/
apps/web/playwright-report/
```

- [ ] **Step 3: Write the config**

Create `apps/web/playwright.config.ts`:

```typescript
import { defineConfig, devices } from '@playwright/test'

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
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: {
    command: `yarn dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

- [ ] **Step 4: Add the scripts**

In `apps/web/package.json`, after `test:integration:secrets`:

```json
"test:e2e": "playwright test",
"test:e2e:secrets": "infisical run --project-config-dir=../.. -- yarn test:e2e"
```

- [ ] **Step 5: Write the failing smoke test**

Create `apps/web/tests/e2e/smoke.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

test('the privacy page renders at this viewport', async ({ page }) => {
  await page.goto('/privacy')
  await expect(
    page.getByRole('heading', { name: 'What we collect' }),
  ).toBeVisible()
})
```

- [ ] **Step 6: Run it and watch it pass**

Run: `cd apps/web && yarn test:e2e`
Expected: 2 passed (phone + tablet). If the dev server is not already up, Playwright starts it.

Note: `/privacy` is public, so no auth is needed yet. If this fails with a redirect to `/sign-in`, the proxy's public-route matcher is wrong and that is a real bug to report before continuing.

- [ ] **Step 7: Commit**

```bash
cd ~/weather-station
yarn format
git add apps/web/package.json apps/web/playwright.config.ts apps/web/tests/e2e/smoke.spec.ts .gitignore yarn.lock
git commit -m "test(web): playwright harness for responsive checks"
```

---

### Task 2: Clerk authentication for the suite

**Files:**
- Create: `apps/web/tests/e2e/global.setup.ts`
- Modify: `apps/web/playwright.config.ts` (add the `setup` project + `storageState`)
- Modify: `apps/web/.env.example`
- Create: `apps/web/tests/e2e/authed.spec.ts`

**Interfaces:**
- Consumes: Task 1's config and projects.
- Produces: `apps/web/playwright/.clerk/user.json` — a signed-in storage state every later spec loads via `storageState`.

- [ ] **Step 1: Document the new environment variable**

Append to `apps/web/.env.example`:

```bash
# Address the Playwright suite signs in as. Clerk Testing Tokens mint a
# server-side session from the address alone — no password is involved.
# Requires a Clerk DEVELOPMENT instance.
E2E_CLERK_USER_EMAIL=
```

- [ ] **Step 2: Write the setup project**

Create `apps/web/tests/e2e/global.setup.ts`:

```typescript
import path from 'node:path'

import { clerk, clerkSetup } from '@clerk/testing/playwright'
import { test as setup } from '@playwright/test'

// Must run serially — the token fetch races itself otherwise.
setup.describe.configure({ mode: 'serial' })

export const AUTH_FILE = path.join(__dirname, '../../playwright/.clerk/user.json')

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
})
```

(`app/(app)/layout.tsx:20` mounts `<AppShell testId="app-shell">`, so that selector is correct as written — no lookup needed.)

- [ ] **Step 3: Wire the setup project into the config**

In `apps/web/playwright.config.ts`, replace the `projects` array:

```typescript
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        storageState: 'playwright/.clerk/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        storageState: 'playwright/.clerk/user.json',
      },
      dependencies: ['setup'],
    },
  ],
```

`clerkSetup()` MUST live in a project like this, not in a function-based `globalSetup` — that runs in its own process and `CLERK_FAPI` / `CLERK_TESTING_TOKEN` never reach the workers.

- [ ] **Step 4: Write the failing authed test**

Create `apps/web/tests/e2e/authed.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

test('the dashboard is reachable when signed in', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('link', { name: 'Weather Station' })).toBeVisible()
})
```

- [ ] **Step 5: Run it to verify it fails first**

Run: `cd apps/web && E2E_CLERK_USER_EMAIL= yarn test:e2e --project=phone tests/e2e/authed.spec.ts`
Expected: FAIL in setup with "E2E_CLERK_USER_EMAIL is not set". This proves the guard works rather than silently running signed-out.

- [ ] **Step 6: Run it properly and watch it pass**

Run: `cd apps/web && yarn test:e2e:secrets`
Expected: setup passes, then all specs pass on both projects. If sign-in fails with "Clerk Frontend API URL is required", Step 4 was not applied correctly.

- [ ] **Step 7: Commit**

```bash
cd ~/weather-station
yarn format
git add apps/web/tests/e2e apps/web/playwright.config.ts apps/web/.env.example
git commit -m "test(web): sign the e2e suite in via clerk testing tokens"
```

---

### Task 3: The layout assertion helper

The heart of the suite. It must be proven to *fail* on a broken page, or it is a no-op that reports green forever.

**Files:**
- Create: `apps/web/tests/e2e/helpers/layout.ts`
- Create: `apps/web/tests/e2e/helpers/layout.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `expectNoHorizontalOverflow(page: Page): Promise<void>`
  - `expectNothingClipped(page: Page): Promise<void>`
  - `expectTapTargets(page: Page): Promise<void>`

- [ ] **Step 1: Write the helper**

Create `apps/web/tests/e2e/helpers/layout.ts`:

```typescript
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/** Sub-pixel rounding means an exact comparison flaps; 1 px is not a bug. */
const TOLERANCE = 1

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
  const offenders = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    const out: { tag: string; testId: string; right: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (el.closest('[data-allow-x-scroll]')) continue
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
    // Innermost offenders are the actionable ones; a clipped parent is noise.
    return out.slice(0, 10)
  })
  expect(
    offenders,
    `elements cross the right edge:\n${offenders
      .map((o) => `  ${o.tag}${o.testId ? `[${o.testId}]` : ''} right=${o.right}px`)
      .join('\n')}`,
  ).toEqual([])
}

const MIN_TAP = 44

/**
 * Controls only. Links inside prose are text — padding them to 44 px would
 * wreck the paragraph — so only control-styled links (those carrying a
 * rounded-control class) are measured.
 */
export const expectTapTargets = async (page: Page): Promise<void> => {
  const small = await page.evaluate((min) => {
    const sel = 'button, input, select, [role="button"], a.rounded-control'
    const out: { tag: string; testId: string; w: number; h: number }[] = []
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.width < min || rect.height < min) {
        out.push({
          tag: el.tagName.toLowerCase(),
          testId: el.dataset.testid ?? '',
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        })
      }
    }
    return out
  }, MIN_TAP)
  expect(
    small,
    `controls smaller than ${MIN_TAP}px:\n${small
      .map((s) => `  ${s.tag}${s.testId ? `[${s.testId}]` : ''} ${s.w}×${s.h}`)
      .join('\n')}`,
  ).toEqual([])
}
```

- [ ] **Step 2: Write the test that proves the helper catches a real defect**

Create `apps/web/tests/e2e/helpers/layout.spec.ts`:

```typescript
import { expect, test } from '@playwright/test'

import {
  expectNoHorizontalOverflow,
  expectNothingClipped,
} from './layout'

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
    const inner = document.createElement('div')
    inner.style.width = '3000px'
    inner.style.height = '10px'
    inner.dataset.testid = 'deliberate-clip'
    box.append(inner)
    document.body.append(box)
  })
  // The page does NOT scroll — this is exactly the case the first check misses.
  await expectNoHorizontalOverflow(page)
  await expect(expectNothingClipped(page)).rejects.toThrow(/cross the right edge/)
})
```

- [ ] **Step 3: Run and verify all three pass**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/helpers/layout.spec.ts`
Expected: 6 passed (3 tests × 2 projects). If test 3 fails at the `expectNoHorizontalOverflow` line, the injected box is producing a scrollbar — set `box.style.maxWidth = '100px'` too.

- [ ] **Step 4: Commit**

```bash
cd ~/weather-station
yarn format
git add apps/web/tests/e2e/helpers
git commit -m "test(web): layout assertions, proven against deliberate defects"
```

---

### Task 4: Seeded device fixture

**Files:**
- Create: `apps/web/tests/e2e/helpers/seed.ts`
- Modify: `apps/web/tests/e2e/global.setup.ts`

**Interfaces:**
- Consumes: the signed-in `page` inside Task 2's setup step (for the Clerk user id).
- Produces: `apps/web/playwright/.clerk/fixtures.json` shaped `{ deviceId: string }`, and `readFixtures(): { deviceId: string }` exported from `seed.ts`.

- [ ] **Step 1: Write the seed helper**

Create `apps/web/tests/e2e/helpers/seed.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

export interface Fixtures {
  deviceId: string
}

const FIXTURES_FILE = path.join(
  __dirname,
  '../../../playwright/.clerk/fixtures.json',
)

export const readFixtures = (): Fixtures =>
  JSON.parse(readFileSync(FIXTURES_FILE, 'utf8')) as Fixtures

const service = (): SupabaseClient<Database> => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).')
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  })
}

/**
 * A device the suite owns outright. Depending on whatever is in the local
 * database would make these specs order-dependent and fragile.
 */
export const seedDevice = async (clerkUserId: string): Promise<Fixtures> => {
  const client = service()
  const deviceId = 'ws-e2e00000001'

  await client.from('devices').upsert(
    { device_id: deviceId, secret: 'e2e-not-a-real-secret', status: 'registered' },
    { onConflict: 'device_id' },
  )

  const { data: user } = await client
    .from('users')
    .upsert({ clerk_user_id: clerkUserId }, { onConflict: 'clerk_user_id' })
    .select('id')
    .single()
  if (!user) throw new Error('could not resolve the test users row')

  await client
    .from('device_users')
    .upsert(
      { device_id: deviceId, user_id: user.id, role: 'owner' },
      { onConflict: 'device_id,user_id' },
    )

  // A few readings so the dashboard and chart render content, not empty states.
  const now = Date.now()
  await client.from('readings').upsert(
    Array.from({ length: 24 }, (_, i) => ({
      device_id: deviceId,
      timestamp: new Date(now - i * 3_600_000).toISOString(),
      temperature: 20 + i * 0.1,
      humidity: 50,
      pressure: 1013,
      wind_speed: 3,
      wind_direction: 180,
      precipitation: 0,
    })),
    { onConflict: 'device_id,timestamp' },
  )

  mkdirSync(path.dirname(FIXTURES_FILE), { recursive: true })
  writeFileSync(FIXTURES_FILE, JSON.stringify({ deviceId }))
  return { deviceId }
}
```

Every `onConflict` above is backed by a real constraint, confirmed against
`20260709211117_init_schema.sql`: `devices.device_id` is the primary key (:16),
`device_users` is `primary key (device_id, user_id)` (:34), and
`readings_device_id_timestamp_idx` is a unique index on `(device_id, timestamp)`
(:58). No lookup needed.

- [ ] **Step 2: Call it from setup**

In `apps/web/tests/e2e/global.setup.ts`, inside the `sign in and save the session` step, after `storageState`:

```typescript
  const clerkUserId = await page.evaluate(
    () => (window as unknown as { Clerk?: { user?: { id: string } } }).Clerk?.user?.id ?? '',
  )
  if (!clerkUserId) throw new Error('Clerk did not expose a signed-in user id')
  await seedDevice(clerkUserId)
```

and add the import: `import { seedDevice } from './helpers/seed'`

- [ ] **Step 3: Run setup and verify the fixture file appears**

Run: `cd apps/web && yarn test:e2e:secrets --project=setup && cat playwright/.clerk/fixtures.json`
Expected: `{"deviceId":"ws-e2e00000001"}`

- [ ] **Step 4: Commit**

```bash
cd ~/weather-station
yarn format
git add apps/web/tests/e2e
git commit -m "test(web): seed a device the e2e suite owns"
```

---

### Task 5: The route matrix — lands the real failures

**Files:**
- Create: `apps/web/tests/e2e/responsive.spec.ts`
- Delete: `apps/web/tests/e2e/smoke.spec.ts`, `apps/web/tests/e2e/authed.spec.ts` (superseded)

**Interfaces:**
- Consumes: `expectNoHorizontalOverflow`, `expectNothingClipped` (Task 3); `readFixtures` (Task 4).
- Produces: the failing-route inventory that Tasks 6–10 fix.

- [ ] **Step 1: Write the matrix**

Create `apps/web/tests/e2e/responsive.spec.ts`:

```typescript
import { test } from '@playwright/test'

import { expectNoHorizontalOverflow, expectNothingClipped } from './helpers/layout'
import { readFixtures } from './helpers/seed'

const { deviceId } = readFixtures()

const ROUTES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'devices', path: '/devices' },
  { name: 'device detail', path: `/devices/${deviceId}` },
  { name: 'device register', path: '/devices/register' },
  { name: 'alerts', path: '/alerts' },
  { name: 'settings', path: '/settings' },
  { name: 'admin fleet', path: '/admin', admin: true },
  { name: 'admin users', path: '/admin/users', admin: true },
  { name: 'api reference', path: '/reference' },
  { name: 'privacy', path: '/privacy' },
  { name: 'sign in', path: '/sign-in' },
]

for (const route of ROUTES) {
  test(`${route.name} fits the viewport`, async ({ page }) => {
    await page.goto(route.path)
    // An admin route 404s for a non-admin (refusals are 404, never 403), and
    // that is a fixture gap, not a layout regression. Skipping keeps the two
    // distinguishable — a failing red here always means a real mobile defect.
    if (route.admin && !page.url().includes('/admin')) {
      test.skip(true, 'E2E_CLERK_USER_EMAIL is not a member of ADMIN_ORG_ID')
    }
    // Motion entry animations transform elements; measuring mid-flight reads a
    // position the user never sees. Wait for the page to settle instead of
    // sleeping a fixed amount.
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectNoHorizontalOverflow(page)
    await expectNothingClipped(page)
  })
}
```

- [ ] **Step 2: Run it and record what fails**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/responsive.spec.ts`
Expected: several FAIL on the `phone` project. **Write the failing route names and the offending `testId`s into the task list below before continuing** — that inventory is what Tasks 6–10 are fixing, and the error messages name the exact elements.

- [ ] **Step 3: Mark the known failures so the suite is committable**

Express each expected failure through Playwright's own annotation — never an
eslint-disable, which CLAUDE.md forbids outright:

```typescript
const KNOWN_BROKEN_ON_PHONE = new Set(['device detail', 'admin users'])

for (const route of ROUTES) {
  test(`${route.name} fits the viewport`, async ({ page }, testInfo) => {
    if (testInfo.project.name === 'phone' && KNOWN_BROKEN_ON_PHONE.has(route.name)) {
      test.fail(true, 'known mobile defect — fixed in a later task of this plan')
    }
    // ...rest unchanged
  })
}
```

`test.fail()` makes the suite green while broken, and Playwright errors with "expected to fail but passed" the moment a fix lands — so each later task is forced to remove its own entry from the set rather than leaving a stale annotation.

- [ ] **Step 4: Delete the superseded specs**

```bash
cd apps/web && rm tests/e2e/smoke.spec.ts tests/e2e/authed.spec.ts
```

- [ ] **Step 5: Run the whole suite green**

Run: `cd apps/web && yarn test:e2e:secrets`
Expected: all pass, with the known-broken ones reported as expected failures.

- [ ] **Step 6: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/tests/e2e
git commit -m "test(web): responsive route matrix with the current defects annotated"
```

---

### Task 6: Page gutters

One change, five files, every route narrower by 16 px on each side.

**Files:**
- Modify: `apps/web/src/components/shell/AppShell.tsx:54`
- Modify: `apps/web/src/components/shell/TopNav.tsx:50`
- Modify: `apps/web/src/components/shell/Footer.tsx:7`
- Modify: `apps/web/src/components/shell/ShellSkeleton.tsx:8`
- Modify: `apps/web/src/components/shell/EnsureUser.tsx:52`

**Interfaces:**
- Consumes: Task 5's route matrix.
- Produces: no new exports; routes get 32 px more usable width below `sm`.

- [ ] **Step 1: Apply the gutter to all five**

Each is the same edit — `px-6` becomes `px-4 sm:px-6`:

```tsx
// AppShell.tsx:54
<main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pt-7 pb-16 sm:px-6">

// TopNav.tsx:50
<div className="mx-auto flex h-[60px] max-w-[1180px] items-center gap-6 px-4 sm:px-6">

// Footer.tsx:7
className="text-slate mx-auto flex max-w-[1180px] items-center justify-between px-4 py-8 text-xs sm:px-6"

// ShellSkeleton.tsx:8
<div data-testid={testId} className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6">

// EnsureUser.tsx:52
<div className="mx-auto max-w-[1180px] px-4 py-10 sm:px-6">
```

- [ ] **Step 2: Also fix the TopNav gap**

`TopNav.tsx:50` uses `gap-6` (24 px) between logo, nav, chip, switcher, theme toggle, avatar and hamburger. At 390 px those gaps alone consume more than the screen. Change `gap-6` to `gap-3 sm:gap-6` in the same line as Step 1.

- [ ] **Step 3: Run the unit tests — nothing should break**

Run: `yarn workspace @ws/web test:unit`
Expected: 311 passed. These are class-name changes; any failure means a test asserts on a class string, which should be rewritten to assert behaviour instead.

- [ ] **Step 4: Re-run the responsive suite**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/responsive.spec.ts`
Expected: any route that only failed on gutter width now reports "expected to fail but passed". Remove those names from `KNOWN_BROKEN_ON_PHONE`, re-run, confirm green.

- [ ] **Step 5: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src/components/shell apps/web/tests/e2e
git commit -m "fix(web): tighter page gutter and nav gap below sm"
```

---

### Task 7: Dialog field pairs

**Files:**
- Modify: `apps/web/src/components/alerts/ScheduleDialog.tsx:96`
- Modify: `apps/web/src/components/export/ExportDialog.tsx:103`
- Modify: `apps/web/src/components/devices/DeviceProfileDialog.tsx:133`
- Create: `apps/web/tests/e2e/dialogs.spec.ts`

**Interfaces:**
- Consumes: Task 3's helpers, Task 4's `readFixtures`.
- Produces: nothing new exported.

Dialogs are not reachable by URL, so the route matrix cannot see them. They need their own spec that opens each one.

- [ ] **Step 1: Write the failing dialog spec**

Create `apps/web/tests/e2e/dialogs.spec.ts`:

```typescript
import { test } from '@playwright/test'

import { expectNoHorizontalOverflow, expectNothingClipped } from './helpers/layout'
import { readFixtures } from './helpers/seed'

const { deviceId } = readFixtures()

// testIds verified against source: DashboardView is mounted testId="dashboard"
// and its export button is `${testId}-export`; DeviceDetail is testId="device"
// with `-edit` and `-share`; AlertsView is testId="alerts" with `-add`.
const DIALOGS = [
  { name: 'export csv', path: '/dashboard', trigger: 'dashboard-export' },
  { name: 'share access', path: `/devices/${deviceId}`, trigger: 'device-share' },
  { name: 'device profile', path: `/devices/${deviceId}`, trigger: 'device-edit' },
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/dialogs.spec.ts --project=phone`
Expected: FAIL on at least the export and schedule dialogs, naming the `grid-cols-2` children.

- [ ] **Step 3: Fix the three grids**

In each file, `grid-cols-2` becomes `grid-cols-1 sm:grid-cols-2`:

```tsx
// ScheduleDialog.tsx:96, ExportDialog.tsx:103, DeviceProfileDialog.tsx:133
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/dialogs.spec.ts`
Expected: all pass on both projects.

- [ ] **Step 5: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src/components apps/web/tests/e2e/dialogs.spec.ts
git commit -m "fix(web): stack dialog field pairs below sm"
```

---

### Task 8: MembersList row

The worst offender: six children in a non-wrapping row, made longer by the member email.

**Files:**
- Modify: `apps/web/src/components/devices/MembersList.tsx:62`
- Modify: `apps/web/tests/unit/components/devices/sharing.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exported.

- [ ] **Step 1: Write the failing unit test**

Add to `apps/web/tests/unit/components/devices/sharing.test.tsx` inside `describe('sharing')`:

```tsx
it('gives the row a stacking layout so controls drop below the identity on a phone', () => {
  wrap(
    <MembersList
      testId="ml"
      deviceId="ws-1"
      members={members}
      profiles={{}}
      viewerUserId="u-a"
      canManage
    />,
  )
  const row = screen.getByTestId('ml-row-u-a')
  expect(row.className).toContain('flex-col')
  expect(row.className).toContain('sm:flex-row')
})
```

This asserts on class names, which is normally a smell — here the class *is* the behaviour under test, and jsdom has no layout engine to assert anything better. The e2e suite is what proves the actual result.

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn workspace @ws/web test:unit --testPathPattern sharing`
Expected: FAIL — `className` has no `flex-col`.

- [ ] **Step 3: Restructure the row**

`MembersList.tsx:62` — the `motion.li` className becomes:

```tsx
className="border-line flex flex-col items-start gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
```

The `<span className="flex-1" />` spacer at line 80 only makes sense in a row; wrap the role select and remove button in their own group so they stay together when stacked. Replace lines 79–101 with:

```tsx
      {isSelf ? <Badge testId={`${testId}-you`}>you</Badge> : null}
      <span className="hidden flex-1 sm:block" />
      <span className="flex w-full items-center gap-2 sm:w-auto sm:gap-3">
        {canManage ? (
          <Select<DeviceRole>
            testId={`${testId}-role`}
            ariaLabel="Role"
            value={member.role}
            onValueChange={changeRole}
            options={ROLE_OPTIONS}
          />
        ) : (
          <Badge testId={`${testId}-role-badge`}>{member.role}</Badge>
        )}
        {canManage ? (
          <Button
            testId={`${testId}-remove`}
            variant="ghost"
            size="sm"
            onClick={remove}
          >
            Remove
          </Button>
        ) : null}
      </span>
```

- [ ] **Step 4: Run the unit tests**

Run: `yarn workspace @ws/web test:unit --testPathPattern sharing`
Expected: all pass, including the pre-existing "owners get role selects and remove buttons; viewers get read-only rows".

- [ ] **Step 5: Re-run the e2e suite and unmark the route**

Run: `cd apps/web && yarn test:e2e:secrets`
Expected: `device detail` now reports "expected to fail but passed". Remove it from `KNOWN_BROKEN_ON_PHONE` and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src/components/devices/MembersList.tsx apps/web/tests
git commit -m "fix(web): stack member rows below sm so controls stay reachable"
```

---

### Task 9: Chart header

**Files:**
- Modify: `apps/web/src/components/charts/ChartSection.tsx:57`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exported.

- [ ] **Step 1: Let the header wrap**

`ChartSection.tsx:57`:

```tsx
<div className="flex flex-wrap items-center gap-3">
```

The `flex-1` spacer at line 59 still pushes the range selector right when both fit on one line, and the selector wraps to its own line when they do not.

- [ ] **Step 2: Check the range selector itself fits**

Run: `grep -n "className" apps/web/src/components/charts/RangeSelector.tsx`
If it is a fixed-width row of three buttons wider than ~330 px at phone size, give the group `w-full sm:w-auto` and the buttons `flex-1 sm:flex-none`. If it already fits, change nothing.

- [ ] **Step 3: Re-run the e2e suite**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/responsive.spec.ts`
Expected: `dashboard` and `device detail` pass; unmark anything now green.

- [ ] **Step 4: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src/components/charts apps/web/tests/e2e
git commit -m "fix(web): let the chart header wrap on narrow screens"
```

---

### Task 10: Admin lists

**Files:**
- Modify: `apps/web/src/components/admin/AdminUsersTable.tsx:67`
- Modify: `apps/web/src/components/admin/AdminDevicesTable.tsx:70`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new exported.

Both rows already `flex-wrap`, so they do not overflow — they wrap into an unreadable pile. The fix is an explicit stack with the metadata grouped, not more wrapping.

- [ ] **Step 1: Restructure the users row**

`AdminUsersTable.tsx:67` className becomes:

```tsx
className="border-line flex flex-col items-start gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
```

and the two trailing metadata spans (station count, "since" date) get wrapped together so they read as one line on a phone:

```tsx
                <span className="hidden flex-1 sm:block" />
                <span className="text-slate flex items-center gap-3 text-[13px]">
                  <span>
                    {u.deviceCount} {u.deviceCount === 1 ? 'station' : 'stations'}
                  </span>
                  <span className="text-xs">
                    since {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                </span>
```

- [ ] **Step 2: Restructure the devices row the same way**

`AdminDevicesTable.tsx:70` className becomes:

```tsx
className="border-line flex flex-col items-start gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
```

Replace its `<span className="flex-1" />` (line 89) with `<span className="hidden flex-1 sm:block" />`, and give the `DeviceRowActions` wrapper `w-full sm:w-auto` so its buttons do not squeeze.

- [ ] **Step 3: Run the unit tests**

Run: `yarn workspace @ws/web test:unit`
Expected: 311 passed.

- [ ] **Step 4: Re-run the e2e suite and empty the known-broken set**

Run: `cd apps/web && yarn test:e2e:secrets`
Expected: `admin fleet` and `admin users` pass. `KNOWN_BROKEN_ON_PHONE` should now be empty — delete the constant and the `testInfo` guard entirely rather than leaving an empty set behind.

- [ ] **Step 5: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src/components/admin apps/web/tests/e2e
git commit -m "fix(web): stack admin list rows below sm"
```

---

### Task 11: Tap targets

Landed last on purpose: `Button size="sm"` is `h-8` (32 px), so this will fail in several places and must not block the overflow work.

**Files:**
- Modify: `apps/web/src/components/ui/Button.tsx:23`
- Modify: `apps/web/tests/e2e/responsive.spec.ts`

**Interfaces:**
- Consumes: `expectTapTargets` from Task 3.
- Produces: nothing new exported.

- [ ] **Step 1: Add the check to the route matrix**

In `responsive.spec.ts`, add a second test per route:

```typescript
  test(`${route.name} has thumb-sized controls`, async ({ page }) => {
    await page.goto(route.path)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => document.getAnimations().map((a) => a.finished))
    await expectTapTargets(page)
  })
```

and add `expectTapTargets` to the import from `./helpers/layout`.

- [ ] **Step 2: Run it and record every offender**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/responsive.spec.ts --project=phone`
Expected: FAIL, listing controls with their `testId` and measured size.

- [ ] **Step 3: Grow the small button on touch pointers only**

`Button.tsx:23` — keep the visual size on mouse, grow the hit area where the pointer is coarse:

```typescript
  sm: 'h-8 px-3 text-[13px] max-[639px]:h-11 max-[639px]:px-4',
```

Do not raise `h-8` unconditionally — the dense desktop rows depend on it, and `Select` triggers sit next to these buttons expecting matching heights.

- [ ] **Step 4: Re-run and fix the remainder individually**

Run: `cd apps/web && yarn test:e2e:secrets tests/e2e/responsive.spec.ts`
For each remaining offender, grow the hit area with padding rather than lowering the 44 px threshold in the helper. If an icon-only control cannot grow without breaking its layout, add padding and a negative margin so the target grows while the visual box does not move.

- [ ] **Step 5: Commit**

```bash
cd ~/weather-station
yarn format && yarn lint && yarn check-types
git add apps/web/src apps/web/tests/e2e
git commit -m "fix(web): thumb-sized controls on narrow screens"
```

---

### Task 12: Documentation

**Files:**
- Modify: `README.md` (repo root — there is no `apps/web/README.md`)
- Modify: `docs/superpowers/specs/2026-08-17-mobile-support-design.md` (status line)

- [ ] **Step 1: Document how to run the suite**

Add to the repo README's test section:

```markdown
### Responsive E2E (Playwright)

    cd apps/web
    yarn test:e2e:secrets          # signs in via Clerk testing token, seeds a device

Requires a local Supabase stack, a Clerk **development** instance, and
`E2E_CLERK_USER_EMAIL` set to an account that exists in it. Add that account to
`ADMIN_ORG_ID` to cover the admin console too — without it those specs skip
with a message rather than fail.
```

- [ ] **Step 2: Mark the spec implemented**

Change the spec's `**Status:**` line to `implemented 2026-08-17`.

- [ ] **Step 3: Final full verification**

```bash
cd ~/weather-station
yarn lint && yarn check-types && yarn test:unit && yarn build
cd apps/web && yarn test:e2e:secrets
```
Expected: all green, no `test.fail` annotations remaining anywhere.

- [ ] **Step 4: Commit**

```bash
cd ~/weather-station
yarn format
git add README.md docs/superpowers/specs/2026-08-17-mobile-support-design.md
git commit -m "docs: how to run the responsive e2e suite"
```
