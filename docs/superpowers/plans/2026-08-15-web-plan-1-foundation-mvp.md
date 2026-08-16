# Web UI Plan 1 — Foundation + Phase 2 MVP (MRP-17, 19, 22, 25, 27, 32)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the web dashboard MVP — Clerk auth, Clerk↔Supabase identity, device registration, live dashboard with Realtime, 24-hour charts — on a shared design system (tokens, primitives, motion) that Plan 2 builds on.

**Architecture:** Next.js 16 App Router; client-first data path (browser Supabase client with Clerk JWT + RLS, TanStack Query hooks over pure service functions); server actions only for `users` upsert and device claim (service-role + `claim_device` RPC). Motion (`motion/react`) for a no-overshoot spring vocabulary and one orchestrated "reading arrives" moment. Recharts for SVG charts.

**Tech Stack:** Next 16.2, React 19.2, Tailwind v4, `@clerk/nextjs` 7, `@supabase/supabase-js` 2, `@tanstack/react-query` 5, `motion` 13, `recharts` 3, `radix-ui` 1.6, `next-themes`, `lucide-react`, `react-hook-form` + `zod`, Jest 29 (+ `jest-environment-jsdom` 29, RTL), pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-15-web-dashboard-ui-design.md` (sections §1–§4.3, §6–§8). Visual reference: `docs/superpowers/mockups/2026-08-15-ui-direction/01-instrument.html`.

## Global Constraints

- CLAUDE.md TypeScript rules: **no `any`**, **no `eslint-disable`**, **arrow functions only**, `const` over `let`, `import type` separated from value imports, `ReactElement`/`ReactNode` named imports (never `JSX.Element`), **`testId` prop on every component → `data-testid`**, `useCallback` for functions inside components, `useMemo` for derived values.
- Data paths: all reads and user-scoped writes go through `useSupabaseClient()` hooks; server actions only where listed in the spec §3.4. Modules touching `SUPABASE_SECRET_KEY` start with `import 'server-only'`.
- Services: `services/{domain}/{domain}.service.ts`, `supabase: SupabaseClient<Database>` first param, throw `ServiceError`, alias snake_case → camelCase in `.select()`, never `select('*')` on `readings`, always filter readings by `device_id` + `timestamp`.
- Query keys: `services/{domain}/{domain}.queries.ts`, root key `['domain']`, `as const`, `enabled` guards.
- Pages fetching data must render a skeleton while `!isUserLoaded || isLoading`.
- Tests live under `apps/web/tests/{unit,integration}` mirroring `src/`; unit tests import via `@/`. Component/hook tests use the `/** @jest-environment jsdom */` docblock.
- Migrations: `yarn migrate:new <name>` (from `infra/supabase-db/`), then `yarn regenerate:types`; every RLS/function change gets a pgTAP test with `SELECT ok(...)`.
- Motion: import from `motion/react` only in `'use client'` files; springs `bounce: 0`; respect `useReducedMotion`; never read a MotionValue in render.
- Tokens: exact hex values from spec §1.1; fonts Archivo + DM Mono via `next/font/google`.
- Copy: sentence case, active voice, buttons name the action ("Register device", not "Submit").
- Before every commit: `yarn lint && yarn check-types && yarn test:unit` from the repo root pass; run `yarn format`.

## Branch & commit policy

- Branch from `dev`: `git checkout -b feature/web-mvp-ui dev`.
- One commit per task (messages given per task). Do not squash. Do not push until the plan's final task passes `yarn build`.

## File Structure

```
apps/web/
  package.json                          deps (Task 1)
  jest.config.mjs                       jsdom setup files, tsx (Task 1)
  proxy.ts                              Clerk middleware (Task 6)
  .env.example                          new vars (Task 6)
  src/
    app/
      globals.css                       tokens, fonts vars, base (Task 2)
      layout.tsx                        fonts + <RootProviders> (Task 2)
      page.tsx                          redirect → /dashboard (Task 6)
      sign-in/[[...sign-in]]/page.tsx   (Task 6)
      sign-up/[[...sign-up]]/page.tsx   (Task 6)
      (app)/layout.tsx                  AppShell + EnsureUser (Task 8)
      (app)/template.tsx                route fade (Task 8)
      (app)/dashboard/page.tsx          (Task 13)
      (app)/devices/register/page.tsx   (Task 10)
      (app)/settings/page.tsx           Appearance only (Task 8)
    lib/
      utils.ts                          cn() (Task 1)
      fonts.ts                          Archivo/DM Mono (Task 2)
      query-client.tsx                  QueryProvider (Task 2)
      supabase.ts                       useSupabaseClient (Task 2)
      actions/result.ts                 ActionResult, actionOk/actionError (Task 7)
      auth/public-routes.ts             isPublicRoute matcher (Task 6)
      clerk-appearance.ts               (Task 6)
      parameters.ts                     PARAMETERS registry (Task 11)
      format.ts                         units, relative time, bearings (Task 11)
      chart.ts                          history points, gaps, trend, ranges (Task 11)
    components/
      providers/RootProviders.tsx       Clerk › Theme › Query › Motion (Task 2)
      ui/{Button,Card,Skeleton,Badge,EmptyState,Input,Field}.tsx   (Task 3)
      ui/{Dialog,Sheet,Toast}.tsx                                  (Task 4)
      ui/index.ts
      motion/{variants.ts,MotionProvider,NumberRoll,FreshnessPulse,Reveal}.tsx (Task 5)
      shell/{AppShell,TopNav,MobileNav,DeviceChip,ThemeToggle,Footer}.tsx (Task 8)
      shell/EnsureUser.tsx              (Task 8)
      devices/RegisterDeviceForm.tsx    (Task 10)
      dashboard/{ConditionsStrip,ParameterCard,ParameterCardGrid,TrendGlyph,
                 CompassGlyph,NoDeviceState,WaitingForReading,DashboardSkeleton}.tsx (Task 12)
      charts/{Sparkline,ParameterChart,ChartTooltip,useChartData.ts} (Task 13)
    services/
      database/types.ts                 (exists) ServiceError
      users/users.service.ts + users.queries.ts        (Task 7)
      devices/devices.service.ts + devices.queries.ts  (Task 10)
      readings/readings.service.ts (extend) + readings.queries.ts + readings.realtime.ts (Task 11)
    actions/
      users.action.ts                   ensureCurrentUserAction (Task 7)
      devices.action.ts                 registerDeviceAction (Task 10)
  tests/
    stubs/motion-react.tsx, next-navigation.ts, jest-dom-setup.ts (Task 1)
    unit/… mirrors src (per task)
    integration/services/{users,devices,readings}/… (per task)
infra/supabase-db/supabase/
  migrations/<ts>_enable_readings_realtime.sql   (Task 9)
  migrations/<ts>_claim_device_fn.sql            (Task 9)
  tests/realtime_publication.sql, claim_device.sql (Task 9)
docs/superpowers/verification/2026-xx-xx-mrp-32-web-onboarding.md (Task 14)
```

---

### Task 1: Dependencies, Jest jsdom project, `cn()`

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/jest.config.mjs`
- Create: `apps/web/tests/stubs/jest-dom-setup.ts`
- Create: `apps/web/tests/stubs/motion-react.tsx`
- Create: `apps/web/tests/stubs/next-navigation.ts`
- Create: `apps/web/src/lib/utils.ts`
- Test: `apps/web/tests/unit/lib/utils.test.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils`.
- Produces: jsdom test docblock convention; `motion/react` and `next/navigation` stubs available to every unit test via `moduleNameMapper`.

- [ ] **Step 1: Add dependencies**

```bash
cd apps/web
yarn add @clerk/nextjs@^7 @tanstack/react-query@^5 motion@^13 recharts@^3 radix-ui@^1.6 next-themes@^0.4 lucide-react clsx tailwind-merge react-hook-form@^7 @hookform/resolvers@^5
yarn add -D jest-environment-jsdom@^29 @testing-library/react@^16 @testing-library/jest-dom@^6 @testing-library/user-event@^14 @tanstack/react-query-devtools@^5
```

`jest-environment-jsdom` must match Jest 29 (the workspace pins `jest ^29.7`).

- [ ] **Step 2: Extend Jest config for TSX, jsdom setup, and stubs**

Replace `apps/web/jest.config.mjs` with:

```js
/** @type {import('jest').Config} */
const tsProject = (displayName, dir) => ({
  displayName,
  testMatch: [`<rootDir>/tests/${dir}/**/*.test.{ts,tsx}`],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          verbatimModuleSyntax: false,
          jsx: 'react-jsx',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^server-only$': '<rootDir>/tests/stubs/server-only.ts',
    '^motion/react$': '<rootDir>/tests/stubs/motion-react.tsx',
    '^next/navigation$': '<rootDir>/tests/stubs/next-navigation.ts',
    '\\.css$': '<rootDir>/tests/stubs/style.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/tests/stubs/jest-dom-setup.ts'],
})

const config = {
  projects: [
    tsProject('unit', 'unit'),
    tsProject('integration', 'integration'),
  ],
}

export default config
```

Create `apps/web/tests/stubs/style.ts`:

```ts
export {}
```

Create `apps/web/tests/stubs/jest-dom-setup.ts`:

```ts
import '@testing-library/jest-dom'
```

Create `apps/web/tests/stubs/motion-react.tsx` — a behaviour-preserving stub so component tests don't depend on animation internals:

```tsx
/* Test stub for `motion/react`: renders plain elements, no animation. */
import type { ReactElement, ReactNode } from 'react'
import { createElement, forwardRef } from 'react'

const MOTION_PROPS = new Set([
  'initial', 'animate', 'exit', 'variants', 'transition', 'whileHover',
  'whileTap', 'whileInView', 'viewport', 'layout', 'layoutId', 'style',
])

const stripMotionProps = (props: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    if (!MOTION_PROPS.has(key)) out[key] = props[key]
  }
  if (typeof props.style === 'object' && props.style !== null) out.style = props.style
  return out
}

const make = (tag: string) =>
  forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
    createElement(tag, { ...stripMotionProps(props), ref }),
  )

export const motion: Record<string, ReturnType<typeof make>> = new Proxy(
  {},
  { get: (_target, tag: string) => make(tag) },
)

export const AnimatePresence = ({ children }: { children?: ReactNode }): ReactElement => <>{children}</>
export const MotionConfig = ({ children }: { children?: ReactNode }): ReactElement => <>{children}</>
export const LayoutGroup = ({ children }: { children?: ReactNode }): ReactElement => <>{children}</>

export const reducedMotionState = { value: false }
export const useReducedMotion = (): boolean => reducedMotionState.value

interface StubMotionValue<T> { get: () => T; set: (v: T) => void; on: () => () => void }
const mv = <T,>(v: T): StubMotionValue<T> => {
  let current = v
  return { get: () => current, set: (n) => { current = n }, on: () => () => undefined }
}
export const useMotionValue = <T,>(v: T): StubMotionValue<T> => mv(v)
export const useSpring = <T,>(v: T): StubMotionValue<T> => mv(v)
export const useTransform = <T,>(fn: () => T): StubMotionValue<T> => mv(fn())
export const animate = (): { stop: () => void } => ({ stop: () => undefined })
```

Create `apps/web/tests/stubs/next-navigation.ts`:

```ts
/* Test stub for `next/navigation` — tests override with jest.spyOn as needed. */
export const routerState = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
}
export const navState = { pathname: '/', search: new URLSearchParams() }

export const useRouter = () => routerState
export const usePathname = () => navState.pathname
export const useSearchParams = () => navState.search
export const redirect = (url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`)
}
```

- [ ] **Step 3: Write the failing `cn` test**

`apps/web/tests/unit/lib/utils.test.ts`:

```ts
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conditional classes and resolves tailwind conflicts', () => {
    expect(cn('p-2', false && 'hidden', 'p-4')).toBe('p-4')
    expect(cn('text-ink', undefined, ['rounded-card', { 'opacity-50': true }])).toBe(
      'text-ink rounded-card opacity-50',
    )
  })
})
```

- [ ] **Step 4: Run to verify it fails**

Run: `yarn workspace @ws/web test:unit -t cn`
Expected: FAIL — cannot find module `@/lib/utils`.

- [ ] **Step 5: Implement `cn`**

`apps/web/src/lib/utils.ts`:

```ts
import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class joiner: later classes win on conflict. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
```

- [ ] **Step 6: Run to verify it passes; lint & types**

Run: `yarn workspace @ws/web test:unit -t cn && yarn lint && yarn check-types`
Expected: PASS, no lint or type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json yarn.lock apps/web/jest.config.mjs apps/web/tests/stubs apps/web/src/lib/utils.ts apps/web/tests/unit/lib/utils.test.ts
git commit -m "chore(web): add UI stack deps, jsdom test setup, cn()"
```

---

### Task 2: Design tokens, fonts, root providers

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/lib/fonts.ts`
- Create: `apps/web/src/lib/query-client.tsx`
- Create: `apps/web/src/lib/supabase.ts`
- Create: `apps/web/src/components/providers/RootProviders.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/tests/unit/components/providers/RootProviders.test.tsx`
- Test: `apps/web/tests/unit/lib/supabase.test.ts`

**Interfaces:**
- Produces: CSS custom properties `--color-paper|card|ink|slate|line|sky|danger|temp|hum|press|wind|rain`, `--radius-card|control`, `--font-sans`, `--font-mono`; Tailwind utilities `bg-paper text-ink border-line rounded-card font-mono` etc.
- Produces: `useSupabaseClient(): SupabaseClient<Database>`; `QueryProvider`; `RootProviders`.

- [ ] **Step 1: Tokens and base styles**

Replace `apps/web/src/app/globals.css`:

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --font-sans: var(--font-archivo), system-ui, sans-serif;
  --font-mono: var(--font-dm-mono), ui-monospace, monospace;

  /* Chrome — light-dark() follows html { color-scheme } set by next-themes */
  --color-paper: light-dark(#f7f9fc, #0b1220);
  --color-card: light-dark(#ffffff, #111a2c);
  --color-ink: light-dark(#0b1526, #e8eef7);
  --color-slate: light-dark(#5b6b82, #8b9ab3);
  --color-line: light-dark(#dce3ec, #1e2a3e);
  --color-sky: light-dark(#1e6fe8, #4d8dff);
  --color-danger: light-dark(#d3323a, #ff6b6b);

  /* Parameters — same in both themes; a colour always means "this parameter" */
  --color-temp: #e4572e;
  --color-hum: #1b9aaa;
  --color-press: #7c5ce0;
  --color-wind: #d9a21b;
  --color-rain: #2f5fe0;

  --radius-card: 14px;
  --radius-control: 9px;
  --shadow-card: 0 1px 2px rgb(11 21 38 / 4%);
}

/* Browsers without light-dark(): stay on the light palette. */
@supports not (color: light-dark(#000, #fff)) {
  :root {
    --color-paper: #f7f9fc; --color-card: #ffffff; --color-ink: #0b1526;
    --color-slate: #5b6b82; --color-line: #dce3ec; --color-sky: #1e6fe8;
    --color-danger: #d3323a;
  }
}

:root { color-scheme: light dark; }

@layer base {
  html { font-family: var(--font-sans); }
  body { background: var(--color-paper); color: var(--color-ink); -webkit-font-smoothing: antialiased; }
  :focus-visible { outline: 2px solid var(--color-sky); outline-offset: 2px; }
  /* Instrument numerals: narrow, tabular, tight */
  .readout {
    font-variation-settings: 'wdth' 82;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    font-weight: 600;
  }
  .readout-hero { font-variation-settings: 'wdth' 75; letter-spacing: -0.04em; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
  }
}
```

- [ ] **Step 2: Fonts**

`apps/web/src/lib/fonts.ts`:

```ts
import { Archivo, DM_Mono } from 'next/font/google'

export const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
  display: 'swap',
})

export const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
})
```

- [ ] **Step 3: Query provider (with sign-out cache clear)**

`apps/web/src/lib/query-client.tsx`:

```tsx
'use client'

import { useAuth } from '@clerk/nextjs'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import type { ReactElement, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

/** Clears the query cache when the signed-in user changes or signs out. */
const SignOutCleanup = (): null => {
  const { userId, isLoaded } = useAuth()
  const queryClient = useQueryClient()
  const prevUserId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!isLoaded) return
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      queryClient.clear()
    }
    prevUserId.current = userId
  }, [userId, isLoaded, queryClient])

  return null
}

export const QueryProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: 1 } } }),
  )
  return (
    <QueryClientProvider client={queryClient}>
      <SignOutCleanup />
      {children}
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  )
}
```

- [ ] **Step 4: Browser Supabase client hook (CLAUDE.md canonical)**

`apps/web/src/lib/supabase.ts`:

```ts
'use client'

import { useSession } from '@clerk/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'
import { useMemo } from 'react'

/**
 * Publishable-key client with the Clerk session token attached, so Postgres
 * RLS resolves the user via current_app_user_id(). One client per session.
 */
export const useSupabaseClient = (): SupabaseClient<Database> => {
  const { session } = useSession()
  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { accessToken: async () => (await session?.getToken()) ?? null },
      ),
    [session],
  )
}
```

- [ ] **Step 5: Root providers + layout**

`apps/web/src/components/providers/RootProviders.tsx`:

```tsx
'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
import type { ReactElement, ReactNode } from 'react'

import { MotionProvider } from '@/components/motion/MotionProvider'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { QueryProvider } from '@/lib/query-client'

export const RootProviders = ({ children }: { children: ReactNode }): ReactElement => (
  <ClerkProvider appearance={clerkAppearance}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem enableColorScheme>
      <QueryProvider>
        <MotionProvider>{children}</MotionProvider>
      </QueryProvider>
    </ThemeProvider>
  </ClerkProvider>
)
```

`MotionProvider` arrives in Task 5 and `clerkAppearance` in Task 6; until then create the two minimal placeholders so this task compiles, and Tasks 5/6 replace them:

`apps/web/src/components/motion/MotionProvider.tsx` (placeholder, replaced in Task 5):

```tsx
'use client'

import type { ReactElement, ReactNode } from 'react'

export const MotionProvider = ({ children }: { children: ReactNode }): ReactElement => <>{children}</>
```

`apps/web/src/lib/clerk-appearance.ts` (placeholder, replaced in Task 6):

```ts
import type { Appearance } from '@clerk/nextjs/types'

export const clerkAppearance: Appearance = {}
```

Replace `apps/web/src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactElement, ReactNode } from 'react'

import { RootProviders } from '@/components/providers/RootProviders'
import { archivo, dmMono } from '@/lib/fonts'

import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Weather Station', template: '%s · Weather Station' },
  description: 'Hyperlocal weather monitoring',
}

const RootLayout = ({ children }: Readonly<{ children: ReactNode }>): ReactElement => (
  <html lang="en" suppressHydrationWarning className={`${archivo.variable} ${dmMono.variable}`}>
    <body className="min-h-dvh bg-paper text-ink antialiased">
      <RootProviders>{children}</RootProviders>
    </body>
  </html>
)

export default RootLayout
```

`suppressHydrationWarning` is required because next-themes sets the class/`color-scheme` on `<html>` before hydration.

- [ ] **Step 6: Tests**

`apps/web/tests/unit/lib/supabase.test.ts`:

```ts
/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react'

const getToken = jest.fn().mockResolvedValue('clerk-jwt')
jest.mock('@clerk/nextjs', () => ({ useSession: () => ({ session: { getToken } }) }))

const createClient = jest.fn(() => ({ tag: 'client' }))
jest.mock('@supabase/supabase-js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }))

import { useSupabaseClient } from '@/lib/supabase'

describe('useSupabaseClient', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'pk'
  })

  it('creates one client per session and forwards the Clerk token', async () => {
    const { result, rerender } = renderHook(() => useSupabaseClient())
    rerender()
    expect(createClient).toHaveBeenCalledTimes(1)
    const opts = createClient.mock.calls[0]?.[2] as { accessToken: () => Promise<string | null> }
    await expect(opts.accessToken()).resolves.toBe('clerk-jwt')
    expect(result.current).toEqual({ tag: 'client' })
  })
})
```

`apps/web/tests/unit/components/providers/RootProviders.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

jest.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: ReactElement }) => children,
  useAuth: () => ({ userId: 'user_1', isLoaded: true }),
}))

import { RootProviders } from '@/components/providers/RootProviders'

const Probe = (): ReactElement => {
  const qc = useQueryClient()
  return <div data-testid="probe">{qc ? 'query-ok' : 'no-query'}</div>
}

describe('RootProviders', () => {
  it('provides a query client to children', () => {
    render(<RootProviders><Probe /></RootProviders>)
    expect(screen.getByTestId('probe')).toHaveTextContent('query-ok')
  })
})
```

- [ ] **Step 7: Run tests, lint, types, dev smoke**

Run: `yarn workspace @ws/web test:unit && yarn lint && yarn check-types`
Expected: PASS. Then `infisical run -- yarn workspace @ws/web dev`, open `http://localhost:3000` — the placeholder page renders in Archivo on `paper`; toggling the OS theme flips the background (light-dark).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/tests
git commit -m "feat(web): design tokens, fonts, root providers (Clerk, theme, query)"
```

---

### Task 3: UI primitives I — Button, Card, Skeleton, Badge, EmptyState, Input, Field

**Files:**
- Create: `apps/web/src/components/ui/Button.tsx`, `Card.tsx`, `Skeleton.tsx`, `Badge.tsx`, `EmptyState.tsx`, `Input.tsx`, `Field.tsx`, `index.ts`
- Test: `apps/web/tests/unit/components/ui/primitives.test.tsx`

**Interfaces (Produces):**
```ts
// Button
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean; testId: string
}
export const Button: ForwardRefExoticComponent<ButtonProps & RefAttributes<HTMLButtonElement>>
// Card
export const Card = ({ testId, className, children, accent?: 'temp'|'hum'|'press'|'wind'|'rain' }): ReactElement
export const CardHeader/CardTitle/CardBody
// Skeleton
export const Skeleton = ({ testId, className }): ReactElement   // pulsing block, aria-hidden
// Badge
export const Badge = ({ testId, tone?: 'neutral'|'live'|'danger'|'muted', children }): ReactElement
// EmptyState
export const EmptyState = ({ testId, title, description?, action?: ReactNode, icon?: ReactNode }): ReactElement
// Input
export const Input: ForwardRefExoticComponent<InputHTMLAttributes<HTMLInputElement> & { testId: string; invalid?: boolean; mono?: boolean }>
// Field
export const Field = ({ testId, label, htmlFor, error?, hint?, children }): ReactElement
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/ui/primitives.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'

describe('ui primitives', () => {
  it('Button renders variants, sizes, loading state and forwards testId', () => {
    render(<Button testId="btn" variant="danger" size="sm" loading>Delete</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.className).toContain('bg-danger')
  })

  it('Card renders an accent bar when accent is given', () => {
    render(<Card testId="card" accent="temp">x</Card>)
    expect(screen.getByTestId('card').getAttribute('data-accent')).toBe('temp')
  })

  it('Skeleton is aria-hidden', () => {
    render(<Skeleton testId="sk" className="h-4 w-10" />)
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Badge live tone shows the live dot', () => {
    render(<Badge testId="b" tone="live">Live</Badge>)
    expect(screen.getByTestId('b-dot')).toBeInTheDocument()
  })

  it('EmptyState renders title, description and action', () => {
    render(<EmptyState testId="es" title="No station yet" description="Register one." action={<Button testId="a">Go</Button>} />)
    expect(screen.getByTestId('es')).toHaveTextContent('No station yet')
    expect(screen.getByTestId('a')).toBeInTheDocument()
  })

  it('Field wires label, error and aria-invalid on the input', () => {
    render(
      <Field testId="f" label="Device ID" htmlFor="dev" error="Unknown ID">
        <Input testId="in" id="dev" invalid />
      </Field>,
    )
    expect(screen.getByLabelText('Device ID')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('f-error')).toHaveTextContent('Unknown ID')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @ws/web test:unit -t "ui primitives"`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/web/src/components/ui/Button.tsx`:

```tsx
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'
import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  testId: string
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-paper hover:opacity-90',
  ghost: 'bg-transparent text-ink border border-line hover:bg-card',
  danger: 'bg-danger text-white hover:opacity-90',
}
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading = false, disabled, className, children, testId, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      data-testid={testId}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-opacity disabled:opacity-60 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
```

`apps/web/src/components/ui/Card.tsx`:

```tsx
import type { HTMLAttributes, ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type CardAccent = 'temp' | 'hum' | 'press' | 'wind' | 'rain'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  testId: string
  accent?: CardAccent
  children: ReactNode
}

const ACCENT: Record<CardAccent, string> = {
  temp: 'before:bg-temp', hum: 'before:bg-hum', press: 'before:bg-press', wind: 'before:bg-wind', rain: 'before:bg-rain',
}

export const Card = ({ testId, accent, className, children, ...rest }: CardProps): ReactElement => (
  <div
    data-testid={testId}
    data-accent={accent}
    className={cn(
      'relative overflow-hidden rounded-card border border-line bg-card shadow-card',
      accent ? `before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${ACCENT[accent]}` : null,
      className,
    )}
    {...rest}
  >
    {children}
  </div>
)

export const CardHeader = ({ testId, className, children }: { testId: string; className?: string; children: ReactNode }): ReactElement => (
  <div data-testid={testId} className={cn('flex items-center gap-3 px-5 pt-4', className)}>{children}</div>
)
export const CardTitle = ({ testId, children }: { testId: string; children: ReactNode }): ReactElement => (
  <h2 data-testid={testId} className="text-[15px] font-semibold tracking-tight">{children}</h2>
)
export const CardBody = ({ testId, className, children }: { testId: string; className?: string; children: ReactNode }): ReactElement => (
  <div data-testid={testId} className={cn('px-5 pb-4', className)}>{children}</div>
)
```

`apps/web/src/components/ui/Skeleton.tsx`:

```tsx
import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

export const Skeleton = ({ testId, className }: { testId: string; className?: string }): ReactElement => (
  <div data-testid={testId} aria-hidden="true" className={cn('animate-pulse rounded-control bg-line/70', className)} />
)
```

`apps/web/src/components/ui/Badge.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'live' | 'danger' | 'muted'
const TONE: Record<BadgeTone, string> = {
  neutral: 'border-line text-slate',
  live: 'border-sky/30 text-sky',
  danger: 'border-danger/40 text-danger',
  muted: 'border-line text-slate opacity-60',
}

export const Badge = ({ testId, tone = 'neutral', children }: { testId: string; tone?: BadgeTone; children: ReactNode }): ReactElement => (
  <span data-testid={testId} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px]', TONE[tone])}>
    {tone === 'live' ? <span data-testid={`${testId}-dot`} className="size-1.5 rounded-full bg-sky" aria-hidden /> : null}
    {children}
  </span>
)
```

`apps/web/src/components/ui/EmptyState.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  testId: string
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
  className?: string
}

export const EmptyState = ({ testId, title, description, action, icon, className }: EmptyStateProps): ReactElement => (
  <div data-testid={testId} className={cn('flex flex-col items-center rounded-card border border-dashed border-line px-6 py-14 text-center', className)}>
    {icon ? <div className="mb-4 text-slate">{icon}</div> : null}
    <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
    {description ? <p className="mt-1 max-w-sm text-sm text-slate">{description}</p> : null}
    {action ? <div className="mt-6">{action}</div> : null}
  </div>
)
```

`apps/web/src/components/ui/Input.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react'
import { forwardRef } from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  testId: string
  invalid?: boolean
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ testId, invalid = false, mono = false, className, ...rest }, ref) => (
    <input
      ref={ref}
      data-testid={testId}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-control border bg-card px-3 text-sm text-ink placeholder:text-slate/70',
        invalid ? 'border-danger' : 'border-line',
        mono ? 'font-mono uppercase tracking-wide' : null,
        className,
      )}
      {...rest}
    />
  ),
)
Input.displayName = 'Input'
```

`apps/web/src/components/ui/Field.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'

interface FieldProps {
  testId: string
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: ReactNode
}

export const Field = ({ testId, label, htmlFor, error, hint, children }: FieldProps): ReactElement => (
  <div data-testid={testId} className="flex flex-col gap-1.5">
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate">{label}</label>
    {children}
    {error ? (
      <p data-testid={`${testId}-error`} role="alert" className="text-[13px] text-danger">{error}</p>
    ) : hint ? (
      <p data-testid={`${testId}-hint`} className="text-[13px] text-slate">{hint}</p>
    ) : null}
  </div>
)
```

`apps/web/src/components/ui/index.ts` (types and values separated):

```ts
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button'
export type { CardAccent } from './Card'
export type { InputProps } from './Input'
export type { BadgeTone } from './Badge'

export { Badge } from './Badge'
export { Button } from './Button'
export { Card, CardBody, CardHeader, CardTitle } from './Card'
export { EmptyState } from './EmptyState'
export { Field } from './Field'
export { Input } from './Input'
export { Skeleton } from './Skeleton'
```

App code imports primitives directly (`@/components/ui/Button`) rather than through the barrel — the barrel exists for tests and convenience only (Vercel `bundle-barrel-imports`).

- [ ] **Step 4: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t "ui primitives" && yarn lint && yarn check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui apps/web/tests/unit/components/ui
git commit -m "feat(web): ui primitives — Button, Card, Skeleton, Badge, EmptyState, Input, Field"
```

---

### Task 4: UI primitives II — Dialog, Sheet, Toast

**Files:**
- Create: `apps/web/src/components/ui/Dialog.tsx`, `Sheet.tsx`, `Toast.tsx`
- Modify: `apps/web/src/components/ui/index.ts`
- Test: `apps/web/tests/unit/components/ui/overlays.test.tsx`

**Interfaces (Produces):**
```ts
// Dialog — controlled; content animates with motion inside AnimatePresence
export const Dialog = ({ open, onOpenChange, title, description?, children, testId }): ReactElement
// Sheet — right-side panel (mobile nav, export in Plan 2)
export const Sheet = ({ open, onOpenChange, title, children, testId, side?: 'right'|'left' }): ReactElement
// Toast — provider + hook
export const ToastProvider = ({ children }): ReactElement
export const useToast = (): { toast: (t: { title: string; description?: string; tone?: 'neutral'|'danger'|'success' }) => void }
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/ui/overlays.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { ToastProvider, useToast } from '@/components/ui/Toast'

const DialogHarness = (): ReactElement => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button testId="open" onClick={() => setOpen(true)}>Open</Button>
      <Dialog testId="dlg" open={open} onOpenChange={setOpen} title="Export CSV" description="Pick a range">
        <p>body</p>
      </Dialog>
    </>
  )
}

const ToastHarness = (): ReactElement => {
  const { toast } = useToast()
  return <Button testId="fire" onClick={() => toast({ title: 'Station registered', tone: 'success' })}>Fire</Button>
}

describe('overlays', () => {
  it('Dialog opens with title and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    await user.click(screen.getByTestId('open'))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Export CSV')
    expect(screen.getByTestId('dlg-content')).toHaveTextContent('body')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Toast renders the fired toast', async () => {
    const user = userEvent.setup()
    render(<ToastProvider><ToastHarness /></ToastProvider>)
    await act(async () => { await user.click(screen.getByTestId('fire')) })
    expect(screen.getByTestId('toast-0')).toHaveTextContent('Station registered')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn workspace @ws/web test:unit -t overlays` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement Dialog**

`apps/web/src/components/ui/Dialog.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface DialogProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export const Dialog = ({ testId, open, onOpenChange, title, description, children, className }: DialogProps): ReactElement => (
  <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <AnimatePresence>
      {open ? (
        <RadixDialog.Portal forceMount>
          <RadixDialog.Overlay asChild forceMount>
            <motion.div
              data-testid={`${testId}-overlay`}
              className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={springs.snappy}
            />
          </RadixDialog.Overlay>
          <RadixDialog.Content asChild forceMount aria-describedby={description ? undefined : ''}>
            <motion.div
              data-testid={testId}
              className={cn(
                'fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-card p-6 shadow-card',
                className,
              )}
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={springs.default}
            >
              <div className="mb-4 flex items-start gap-3">
                <div className="flex-1">
                  <RadixDialog.Title className="text-lg font-semibold tracking-tight">{title}</RadixDialog.Title>
                  {description ? (
                    <RadixDialog.Description className="mt-1 text-sm text-slate">{description}</RadixDialog.Description>
                  ) : null}
                </div>
                <RadixDialog.Close
                  data-testid={`${testId}-close`}
                  aria-label="Close"
                  className="rounded-control p-1 text-slate hover:bg-paper"
                >
                  <X className="size-4" aria-hidden />
                </RadixDialog.Close>
              </div>
              <div data-testid={`${testId}-content`}>{children}</div>
            </motion.div>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      ) : null}
    </AnimatePresence>
  </RadixDialog.Root>
)
```

Note the Radix + Motion rules from the motion skill: `asChild` + a `motion.*` child, `forceMount` on the Radix component inside `AnimatePresence`, state hoisted (`open`/`onOpenChange`). `springs` comes from Task 5 — implement Task 5's `variants.ts` first if executing out of order.

- [ ] **Step 4: Implement Sheet**

`apps/web/src/components/ui/Sheet.tsx`:

```tsx
'use client'

import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog as RadixDialog } from 'radix-ui'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

interface SheetProps {
  testId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  side?: 'right' | 'left'
  children: ReactNode
}

export const Sheet = ({ testId, open, onOpenChange, title, side = 'right', children }: SheetProps): ReactElement => {
  const offset = side === 'right' ? 24 : -24
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-40 bg-ink/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={springs.snappy} />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount>
              <motion.div
                data-testid={testId}
                className={cn('fixed inset-y-0 z-50 w-[min(88vw,360px)] border-line bg-card p-5 shadow-card', side === 'right' ? 'right-0 border-l' : 'left-0 border-r')}
                initial={{ x: offset, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: offset, opacity: 0 }}
                transition={springs.default}
              >
                <div className="mb-4 flex items-center justify-between">
                  <RadixDialog.Title className="text-base font-semibold">{title}</RadixDialog.Title>
                  <RadixDialog.Close data-testid={`${testId}-close`} aria-label="Close" className="rounded-control p-1 text-slate hover:bg-paper">
                    <X className="size-4" aria-hidden />
                  </RadixDialog.Close>
                </div>
                {children}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  )
}
```

- [ ] **Step 5: Implement Toast**

`apps/web/src/components/ui/Toast.tsx`:

```tsx
'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

export type ToastTone = 'neutral' | 'danger' | 'success'
export interface ToastInput { title: string; description?: string; tone?: ToastTone; durationMs?: number }
interface ToastItem extends ToastInput { id: number }

interface ToastContextValue { toast: (input: ToastInput) => void }
const ToastContext = createContext<ToastContextValue | null>(null)

const TONE: Record<ToastTone, string> = {
  neutral: 'border-line',
  danger: 'border-danger/50',
  success: 'border-sky/50',
}

export const ToastProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [items, setItems] = useState<ToastItem[]>([])
  const [nextId, setNextId] = useState(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId
      setNextId((n) => n + 1)
      setItems((prev) => [...prev, { ...input, id }])
      window.setTimeout(() => dismiss(id), input.durationMs ?? 4000)
    },
    [dismiss, nextId],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              data-testid={`toast-${t.id}`}
              role="status"
              className={cn('pointer-events-auto rounded-card border bg-card p-3 shadow-card', TONE[t.tone ?? 'neutral'])}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={springs.default}
              onClick={() => dismiss(t.id)}
            >
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description ? <p className="mt-0.5 text-[13px] text-slate">{t.description}</p> : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
```

`onClick={() => dismiss(t.id)}` inside `.map` is the one inline callback we accept: it closes over the item id and `dismiss` is stable — extracting a `ToastRow` component would be the alternative if the lint rule flags it.

Add to `ui/index.ts`: `export type { ToastInput, ToastTone } from './Toast'` and `export { Dialog } from './Dialog'`, `export { Sheet } from './Sheet'`, `export { ToastProvider, useToast } from './Toast'`.

Mount `ToastProvider` inside `RootProviders` (below `MotionProvider`):

```tsx
<MotionProvider><ToastProvider>{children}</ToastProvider></MotionProvider>
```

- [ ] **Step 6: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t overlays && yarn lint && yarn check-types` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components apps/web/tests/unit/components/ui/overlays.test.tsx
git commit -m "feat(web): Dialog, Sheet, Toast primitives with presence animation"
```

---

### Task 5: Motion helpers — variants, MotionProvider, NumberRoll, FreshnessPulse, Reveal

**Files:**
- Create: `apps/web/src/components/motion/variants.ts`
- Replace: `apps/web/src/components/motion/MotionProvider.tsx`
- Create: `apps/web/src/components/motion/NumberRoll.tsx`, `FreshnessPulse.tsx`, `Reveal.tsx`
- Create: `apps/web/src/lib/number-format.ts`
- Test: `apps/web/tests/unit/lib/number-format.test.ts`, `apps/web/tests/unit/components/motion/motion.test.tsx`

**Interfaces (Produces):**
```ts
export const springs = { default: { type: 'spring', bounce: 0, visualDuration: 0.35 }, snappy: { type: 'spring', bounce: 0, visualDuration: 0.2 } } as const
export const fadeUp: Variants          // hidden → visible (y 12 → 0)
export const stagger: Variants         // container: staggerChildren 0.06
export const NumberRoll = ({ value: number | null, decimals: number, testId, className? }): ReactElement
export const FreshnessPulse = ({ status: 'live'|'stale'|'reconnecting'|'offline', pulseKey?: number, testId }): ReactElement
export const Reveal = ({ children, testId, className?, delay? }): ReactElement
export const formatNumber = (value: number, decimals: number): string   // '21.4', '1013.2', '—' for NaN
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/lib/number-format.test.ts`:

```ts
import { formatNumber } from '@/lib/number-format'

describe('formatNumber', () => {
  it('fixes decimals and uses an em dash for non-finite', () => {
    expect(formatNumber(21.44, 1)).toBe('21.4')
    expect(formatNumber(1013, 1)).toBe('1013.0')
    expect(formatNumber(58, 0)).toBe('58')
    expect(formatNumber(Number.NaN, 1)).toBe('—')
  })
})
```

`apps/web/tests/unit/components/motion/motion.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { NumberRoll } from '@/components/motion/NumberRoll'
import { fadeUp, springs, stagger } from '@/components/motion/variants'

describe('motion helpers', () => {
  it('springs never overshoot', () => {
    expect(springs.default.bounce).toBe(0)
    expect(springs.snappy.bounce).toBe(0)
    expect(fadeUp.hidden).toMatchObject({ opacity: 0, y: 12 })
    expect(stagger.visible).toMatchObject({ transition: { staggerChildren: 0.06 } })
  })

  it('NumberRoll renders the formatted value and an em dash for null', () => {
    const { rerender } = render(<NumberRoll testId="n" value={21.44} decimals={1} />)
    expect(screen.getByTestId('n')).toHaveTextContent('21.4')
    rerender(<NumberRoll testId="n" value={null} decimals={1} />)
    expect(screen.getByTestId('n')).toHaveTextContent('—')
  })

  it('FreshnessPulse exposes its status', () => {
    render(<FreshnessPulse testId="p" status="live" />)
    expect(screen.getByTestId('p')).toHaveAttribute('data-status', 'live')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @ws/web test:unit -t "motion helpers|formatNumber"` — Expected: FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/lib/number-format.ts`:

```ts
export const formatNumber = (value: number, decimals: number): string =>
  Number.isFinite(value) ? value.toFixed(decimals) : '—'
```

`apps/web/src/components/motion/variants.ts`:

```ts
import type { Transition, Variants } from 'motion/react'

/** Data-tool springs: no overshoot, ever. */
export const springs = {
  default: { type: 'spring', bounce: 0, visualDuration: 0.35 },
  snappy: { type: 'spring', bounce: 0, visualDuration: 0.2 },
} as const satisfies Record<string, Transition>

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: springs.default },
}

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.02 } },
}

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: springs.snappy },
  exit: { opacity: 0, transition: springs.snappy },
}
```

`apps/web/src/components/motion/MotionProvider.tsx` (replaces placeholder):

```tsx
'use client'

import { MotionConfig } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { springs } from './variants'

/** Global motion policy: no-overshoot springs, honour prefers-reduced-motion. */
export const MotionProvider = ({ children }: { children: ReactNode }): ReactElement => (
  <MotionConfig reducedMotion="user" transition={springs.default}>
    {children}
  </MotionConfig>
)
```

`apps/web/src/components/motion/NumberRoll.tsx`:

```tsx
'use client'

import { motion, useReducedMotion, useSpring, useTransform } from 'motion/react'
import type { ReactElement } from 'react'
import { useEffect } from 'react'

import { formatNumber } from '@/lib/number-format'
import { cn } from '@/lib/utils'

interface NumberRollProps {
  value: number | null
  decimals: number
  testId: string
  className?: string
}

/**
 * Animates numeric changes with a no-bounce spring; snaps under reduced
 * motion. Renders the MotionValue directly (never reads it during render).
 */
export const NumberRoll = ({ value, decimals, testId, className }: NumberRollProps): ReactElement => {
  const reduced = useReducedMotion()
  const spring = useSpring(value ?? 0, { bounce: 0, visualDuration: 0.5 })
  const text = useTransform(() => formatNumber(spring.get(), decimals))

  useEffect(() => {
    if (value === null) return
    if (reduced) spring.jump(value)
    else spring.set(value)
  }, [value, reduced, spring])

  if (value === null) {
    return <span data-testid={testId} className={cn('readout', className)}>—</span>
  }
  return <motion.span data-testid={testId} className={cn('readout', className)}>{text}</motion.span>
}
```

The test stub for `motion/react` returns `useTransform(fn)` evaluated once, so the jsdom test sees the formatted initial value; real behaviour is verified visually in Task 13.

`apps/web/src/components/motion/FreshnessPulse.tsx`:

```tsx
'use client'

import { motion, useReducedMotion } from 'motion/react'
import type { ReactElement } from 'react'

import { cn } from '@/lib/utils'

export type FreshnessStatus = 'live' | 'stale' | 'reconnecting' | 'offline'

interface FreshnessPulseProps {
  status: FreshnessStatus
  /** Change this value to trigger one expanded pulse (e.g. reading id). */
  pulseKey?: number
  testId: string
}

const COLOR: Record<FreshnessStatus, string> = {
  live: 'bg-sky',
  stale: 'bg-slate',
  reconnecting: 'bg-wind',
  offline: 'bg-slate',
}

export const FreshnessPulse = ({ status, pulseKey = 0, testId }: FreshnessPulseProps): ReactElement => {
  const reduced = useReducedMotion()
  return (
    <span data-testid={testId} data-status={status} className="relative inline-flex size-2" aria-hidden>
      <span className={cn('absolute inset-0 rounded-full', COLOR[status])} />
      {status === 'live' && !reduced ? (
        <motion.span
          key={pulseKey}
          className="absolute inset-0 rounded-full bg-sky"
          initial={{ scale: 1, opacity: 0.45 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.6 }}
        />
      ) : null}
    </span>
  )
}
```

`apps/web/src/components/motion/Reveal.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { fadeUp } from './variants'

export const Reveal = ({ children, testId, className, delay = 0 }: { children: ReactNode; testId: string; className?: string; delay?: number }): ReactElement => (
  <motion.div
    data-testid={testId}
    className={className}
    variants={fadeUp}
    initial="hidden"
    whileInView="visible"
    viewport={{ once: true, margin: '-40px' }}
    transition={{ delay }}
  >
    {children}
  </motion.div>
)
```

- [ ] **Step 4: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t "motion helpers|formatNumber|overlays" && yarn lint && yarn check-types` — Expected: PASS (overlays now resolves `springs`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/motion apps/web/src/lib/number-format.ts apps/web/tests/unit
git commit -m "feat(web): motion vocabulary — springs, NumberRoll, FreshnessPulse, Reveal"
```

---

### Task 6: Clerk authentication — proxy, sign-in/up pages, appearance, env (MRP-17)

**Files:**
- Create: `apps/web/proxy.ts`
- Create: `apps/web/src/lib/auth/public-routes.ts`
- Replace: `apps/web/src/lib/clerk-appearance.ts`
- Create: `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`
- Create: `apps/web/src/components/shell/AuthFrame.tsx`
- Replace: `apps/web/src/app/page.tsx`
- Modify: `apps/web/.env.example`
- Test: `apps/web/tests/unit/lib/auth/public-routes.test.ts`

**Interfaces (Produces):**
- `PUBLIC_ROUTES: string[]` and `isPublicPath(pathname: string): boolean` from `@/lib/auth/public-routes`.
- `clerkAppearance: Appearance` mapping tokens.
- Env: `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard`.

- [ ] **Step 1: Failing test for the public-route matcher**

`apps/web/tests/unit/lib/auth/public-routes.test.ts`:

```ts
import { isPublicPath } from '@/lib/auth/public-routes'

describe('isPublicPath', () => {
  it.each([
    ['/', true],
    ['/sign-in', true],
    ['/sign-in/factor-one', true],
    ['/sign-up', true],
    ['/privacy', true],
    ['/api/v1/readings', true],
    ['/api/v1/health', true],
    ['/api/v1/openapi.json', true],
    ['/api/webhooks/clerk', true],
    ['/reference', true],
    ['/api-docs', true],
    ['/dashboard', false],
    ['/devices/register', false],
    ['/settings', false],
  ])('%s → %s', (path, expected) => {
    expect(isPublicPath(path)).toBe(expected)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @ws/web test:unit -t isPublicPath` — Expected: FAIL.

- [ ] **Step 3: Implement the matcher and proxy**

`apps/web/src/lib/auth/public-routes.ts`:

```ts
/**
 * Routes that never require a Clerk session. Everything else is protected
 * (PRD W1). Device ingest and docs must stay public: devices authenticate
 * with HMAC, not Clerk.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/privacy',
  '/api/v(.*)',
  '/api/webhooks(.*)',
  '/reference',
  '/api-docs',
] as const

const PUBLIC_MATCHERS = PUBLIC_ROUTES.map((p) => new RegExp(`^${p}$`))

export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_MATCHERS.some((re) => re.test(pathname))
```

`apps/web/proxy.ts` (Next 16 name for middleware; Clerk supports it):

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

import { PUBLIC_ROUTES } from '@/lib/auth/public-routes'

const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTES])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    // Skip Next internals and static assets
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|avif)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

`auth.protect()` redirects signed-out visitors to `NEXT_PUBLIC_CLERK_SIGN_IN_URL` with `redirect_url` set to the requested page, satisfying "after auth the user returns to the requested page".

- [ ] **Step 4: Clerk appearance mapped to tokens**

`apps/web/src/lib/clerk-appearance.ts`:

```ts
import type { Appearance } from '@clerk/nextjs/types'

/** Maps Clerk components onto the design tokens (spec §1.1). */
export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: '#1e6fe8',
    colorDanger: '#d3323a',
    colorBackground: 'var(--color-card)',
    colorText: 'var(--color-ink)',
    colorTextSecondary: 'var(--color-slate)',
    colorInputBackground: 'var(--color-card)',
    colorInputText: 'var(--color-ink)',
    borderRadius: '9px',
    fontFamily: 'var(--font-sans)',
  },
  elements: {
    card: 'shadow-card border border-line',
    formButtonPrimary: 'bg-ink hover:opacity-90 text-paper',
    footerActionLink: 'text-sky',
  },
}
```


- [ ] **Step 5: Auth pages + frame + root redirect**

`apps/web/src/components/shell/AuthFrame.tsx`:

```tsx
import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'

/** Shell-less frame for sign-in/up and legal pages: brand + content + privacy link. */
export const AuthFrame = ({ children, testId }: { children: ReactNode; testId: string }): ReactElement => (
  <main data-testid={testId} className="flex min-h-dvh flex-col items-center px-4 py-10">
    <Link href="/" className="mb-8 flex items-center gap-2 font-semibold tracking-tight">
      <span aria-hidden className="inline-block size-5 rounded-md bg-gradient-to-br from-sky to-sky/60" />
      Weather Station
    </Link>
    {children}
    <p className="mt-8 text-[13px] text-slate">
      By continuing you agree to the{' '}
      <Link href="/privacy" className="underline underline-offset-2">privacy policy</Link>.
    </p>
  </main>
)
```

`apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`:

```tsx
import { SignIn } from '@clerk/nextjs'
import type { ReactElement } from 'react'

import { AuthFrame } from '@/components/shell/AuthFrame'

const SignInPage = (): ReactElement => (
  <AuthFrame testId="sign-in-page">
    <SignIn />
  </AuthFrame>
)

export default SignInPage
```

`apps/web/src/app/sign-up/[[...sign-up]]/page.tsx`:

```tsx
import { SignUp } from '@clerk/nextjs'
import type { ReactElement } from 'react'

import { AuthFrame } from '@/components/shell/AuthFrame'

const SignUpPage = (): ReactElement => (
  <AuthFrame testId="sign-up-page">
    <SignUp />
  </AuthFrame>
)

export default SignUpPage
```

`apps/web/src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

/** `/` is not a landing page (spec non-goal): send everyone to the dashboard; proxy handles sign-in. */
const Home = (): never => redirect('/dashboard')

export default Home
```

- [ ] **Step 6: Env example**

Append to `apps/web/.env.example` under the Clerk block:

```
# Clerk routing (App Router). Sign-in/up live at these paths; after auth users land on the dashboard.
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
# Clerk dashboard (not code): enable Email + Google; Sessions → Customize session token → add {"role":"authenticated"}
# (required for Supabase third-party auth — without it every RLS query returns empty).
```

Also add these variables to Infisical for dev/preview/prod (documented, done by hand).

- [ ] **Step 7: Verify**

Run: `yarn workspace @ws/web test:unit -t isPublicPath && yarn lint && yarn check-types` — PASS.
Manual: `infisical run -- yarn workspace @ws/web dev`; visiting `/dashboard` signed-out redirects to `/sign-in?redirect_url=…/dashboard`; sign in with email; `/api/v1/health` still answers 200 without a session.

- [ ] **Step 8: Commit**

```bash
git add apps/web/proxy.ts apps/web/src apps/web/.env.example apps/web/package.json yarn.lock apps/web/tests/unit/lib/auth
git commit -m "feat(web): Clerk auth — proxy protection, sign-in/up pages, appearance (MRP-17)"
```

---

### Task 7: Users service, `ActionResult`, `ensureCurrentUserAction` (MRP-19)

**Files:**
- Create: `apps/web/src/lib/actions/result.ts`
- Create: `apps/web/src/services/users/users.service.ts`, `users.queries.ts`
- Create: `apps/web/src/actions/users.action.ts`
- Test: `apps/web/tests/unit/lib/actions/result.test.ts`, `apps/web/tests/unit/services/users/users.service.test.ts`, `apps/web/tests/unit/actions/users.action.test.ts`, `apps/web/tests/integration/services/users/users.service.integration.test.ts`

**Interfaces (Produces):**
```ts
export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> }
export const actionOk = <T,>(data: T): ActionResult<T>
export const actionError = <T,>(code: string, message: string, fieldErrors?: Record<string, string>): ActionResult<T>

export interface CurrentUser { id: string; clerkUserId: string | null; telegramId: number | null; createdAt: string }
export const fetchCurrentUser = (supabase: SupabaseClient<Database>): Promise<CurrentUser | null>
export const userKeys = { all: ['users'] as const, current: ['users', 'current'] as const }
export const useCurrentUserQuery = (): UseQueryResult<CurrentUser | null>
export const ensureCurrentUserAction = (): Promise<ActionResult<{ userId: string }>>
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/lib/actions/result.test.ts`:

```ts
import { actionError, actionOk } from '@/lib/actions/result'

describe('ActionResult helpers', () => {
  it('builds ok and error shapes', () => {
    expect(actionOk({ id: 1 })).toEqual({ ok: true, data: { id: 1 } })
    expect(actionError('DEVICE_NOT_FOUND', 'Unknown', { deviceId: 'Unknown' })).toEqual({
      ok: false, code: 'DEVICE_NOT_FOUND', message: 'Unknown', fieldErrors: { deviceId: 'Unknown' },
    })
  })
})
```

`apps/web/tests/unit/services/users/users.service.test.ts` (mocked client builder — reused pattern for every service test):

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '@/services/database/types'
import { fetchCurrentUser } from '@/services/users/users.service'

const makeClient = (result: { data: unknown; error: unknown }) => {
  const chain = {
    select: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
  }
  return { from: jest.fn(() => chain), chain } as unknown as SupabaseClient<Database> & { chain: typeof chain }
}

describe('fetchCurrentUser', () => {
  it('returns the aliased row', async () => {
    const client = makeClient({ data: { id: 'u1', clerkUserId: 'user_1', telegramId: null, createdAt: 't' }, error: null })
    await expect(fetchCurrentUser(client)).resolves.toEqual({ id: 'u1', clerkUserId: 'user_1', telegramId: null, createdAt: 't' })
    expect(client.chain.select).toHaveBeenCalledWith('id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at')
  })
  it('returns null when RLS yields no row', async () => {
    const client = makeClient({ data: null, error: null })
    await expect(fetchCurrentUser(client)).resolves.toBeNull()
  })
  it('throws ServiceError on error', async () => {
    const client = makeClient({ data: null, error: { message: 'boom', code: '42501', details: null } })
    await expect(fetchCurrentUser(client)).rejects.toBeInstanceOf(ServiceError)
  })
})
```

`apps/web/tests/unit/actions/users.action.test.ts`:

```ts
const auth = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))

const upsert = jest.fn()
const select = jest.fn()
const single = jest.fn()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: () => ({ upsert: (...a: unknown[]) => { upsert(...a); return { select: (...s: unknown[]) => { select(...s); return { single } } } } }),
  }),
}))

import { ensureCurrentUserAction } from '@/actions/users.action'

describe('ensureCurrentUserAction', () => {
  beforeEach(() => { jest.clearAllMocks() })

  it('returns UNAUTHORIZED without a Clerk session', async () => {
    auth.mockResolvedValue({ userId: null })
    await expect(ensureCurrentUserAction()).resolves.toMatchObject({ ok: false, code: 'UNAUTHORIZED' })
  })

  it('upserts by clerk_user_id and returns the internal id', async () => {
    auth.mockResolvedValue({ userId: 'user_1' })
    single.mockResolvedValue({ data: { id: 'uuid-1' }, error: null })
    await expect(ensureCurrentUserAction()).resolves.toEqual({ ok: true, data: { userId: 'uuid-1' } })
    expect(upsert).toHaveBeenCalledWith({ clerk_user_id: 'user_1' }, { onConflict: 'clerk_user_id', ignoreDuplicates: false })
    expect(select).toHaveBeenCalledWith('id')
  })
})
```

`apps/web/tests/integration/services/users/users.service.integration.test.ts` — follow the existing readings integration test's client setup (service-role for setup, an `authenticated` client with a signed JWT for assertions; copy its helper). Assert: user A sees own row via `fetchCurrentUser`, and with user B's JWT the result is `null` (RLS).

- [ ] **Step 2: Run to verify failure**

Run: `yarn workspace @ws/web test:unit -t "ActionResult|fetchCurrentUser|ensureCurrentUserAction"` — FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/lib/actions/result.ts`:

```ts
/**
 * Server actions never throw across the RSC boundary (the error code would be
 * lost); they return this union instead.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string> }

export const actionOk = <T,>(data: T): ActionResult<T> => ({ ok: true, data })

export const actionError = <T,>(code: string, message: string, fieldErrors?: Record<string, string>): ActionResult<T> =>
  fieldErrors ? { ok: false, code, message, fieldErrors } : { ok: false, code, message }
```

`apps/web/src/services/users/users.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface CurrentUser {
  id: string
  clerkUserId: string | null
  telegramId: number | null
  createdAt: string
}

/** Own `users` row (RLS: "users can view own profile"). Null before the first ensureCurrentUserAction. */
export const fetchCurrentUser = async (supabase: SupabaseClient<Database>): Promise<CurrentUser | null> => {
  const { data, error } = await supabase
    .from('users')
    .select('id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at')
    .maybeSingle()

  if (error) {
    throw new ServiceError(`Failed to fetch current user: ${error.message}`, error.code, error.details)
  }
  return data
}
```

`apps/web/src/services/users/users.queries.ts`:

```ts
'use client'

import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

import { useSupabaseClient } from '@/lib/supabase'

import { fetchCurrentUser } from './users.service'

export const userKeys = {
  all: ['users'] as const,
  current: ['users', 'current'] as const,
}

export const useCurrentUserQuery = () => {
  const client = useSupabaseClient()
  const { isSignedIn } = useUser()
  return useQuery({
    queryKey: userKeys.current,
    queryFn: () => fetchCurrentUser(client),
    enabled: !!isSignedIn,
  })
}
```

`apps/web/src/actions/users.action.ts`:

```ts
'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'

/**
 * Guarantees a `users` row for the signed-in Clerk user (PRD D1, MRP-19).
 * Lazy creation (not a webhook): runs from the (app) layout gate before any
 * RLS query, so previews need no webhook config. Idempotent.
 */
export const ensureCurrentUserAction = async (): Promise<ActionResult<{ userId: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('users')
    .upsert({ clerk_user_id: clerkUserId }, { onConflict: 'clerk_user_id', ignoreDuplicates: false })
    .select('id')
    .single()

  if (error || !data) {
    console.error('ensureCurrentUserAction failed', error)
    return actionError('UNKNOWN', 'Could not prepare your account. Try again.')
  }
  return actionOk({ userId: data.id })
}
```

- [ ] **Step 4: Run unit + integration tests**

Run: `yarn workspace @ws/web test:unit -t "ActionResult|fetchCurrentUser|ensureCurrentUserAction" && yarn lint && yarn check-types` — PASS.
Run: `cd infra/supabase-db && yarn db-reset:local && cd ../../apps/web && yarn test:integration -t users` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/actions apps/web/src/services/users apps/web/src/actions/users.action.ts apps/web/tests
git commit -m "feat(web): users service + ensureCurrentUserAction, ActionResult helpers (MRP-19)"
```

---

### Task 8: App shell, `EnsureUser` gate, `(app)` layout, Settings (Appearance)

**Files:**
- Create: `apps/web/src/components/shell/{AppShell,TopNav,MobileNav,ThemeToggle,DeviceChip,Footer,EnsureUser,ShellSkeleton}.tsx`
- Create: `apps/web/src/components/shell/nav-items.ts`
- Create: `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/template.tsx`, `apps/web/src/app/(app)/settings/page.tsx`
- Create: `apps/web/src/components/settings/AppearanceCard.tsx`
- Test: `apps/web/tests/unit/components/shell/shell.test.tsx`

**Interfaces:**
- Consumes: `ensureCurrentUserAction`, `useCurrentUserQuery`, `Button`, `Sheet`, `Skeleton`, `springs`.
- Produces: `NAV_ITEMS: { href: string; label: string }[]` (Plan 1: Dashboard, Settings; Plan 2 appends Alerts, Devices); `AppShell({ children, testId })`; `DeviceChip({ label, testId })`; `EnsureUser({ children })`.

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/shell/shell.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'

import { navState } from '../../../stubs/next-navigation'

jest.mock('@clerk/nextjs', () => ({
  UserButton: () => <div data-testid="user-button" />,
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: { id: 'user_1' } }),
}))
jest.mock('next-themes', () => ({ useTheme: () => ({ theme: 'system', setTheme: jest.fn(), resolvedTheme: 'light' }) }))
const ensure = jest.fn()
jest.mock('@/actions/users.action', () => ({ ensureCurrentUserAction: () => ensure() }))

import { EnsureUser } from '@/components/shell/EnsureUser'
import { TopNav } from '@/components/shell/TopNav'

const wrap = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('shell', () => {
  it('TopNav marks the active item from the pathname', () => {
    navState.pathname = '/settings'
    wrap(<TopNav testId="nav" deviceLabel="WS-7F3A" />)
    expect(screen.getByTestId('nav-link-settings')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('nav-link-dashboard')).not.toHaveAttribute('aria-current')
  })

  it('EnsureUser shows the shell skeleton until the users row exists, then children', async () => {
    let resolve: (v: unknown) => void = () => undefined
    ensure.mockReturnValue(new Promise((r) => { resolve = r }))
    wrap(<EnsureUser><div data-testid="child" /></EnsureUser>)
    expect(screen.getByTestId('shell-skeleton')).toBeInTheDocument()
    resolve({ ok: true, data: { userId: 'u1' } })
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument())
  })

  it('EnsureUser shows a retry state on failure', async () => {
    ensure.mockResolvedValue({ ok: false, code: 'UNKNOWN', message: 'Could not prepare your account. Try again.' })
    wrap(<EnsureUser><div data-testid="child" /></EnsureUser>)
    await waitFor(() => expect(screen.getByTestId('ensure-user-error')).toHaveTextContent('Could not prepare your account'))
  })
})
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t shell` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/components/shell/nav-items.ts`:

```ts
export interface NavItem { href: string; label: string; key: string }
/** Plan 2 appends Alerts and Devices when those routes exist (spec §2.1). */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { key: 'settings', href: '/settings', label: 'Settings' },
]
```

`apps/web/src/components/shell/ThemeToggle.tsx`:

```tsx
'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

const ORDER = ['system', 'light', 'dark'] as const
type Theme = (typeof ORDER)[number]
const ICON: Record<Theme, ReactElement> = {
  system: <Monitor className="size-4" aria-hidden />,
  light: <Sun className="size-4" aria-hidden />,
  dark: <Moon className="size-4" aria-hidden />,
}

export const ThemeToggle = ({ testId }: { testId: string }): ReactElement => {
  const { theme, setTheme } = useTheme()
  const current = (ORDER as readonly string[]).includes(theme ?? '') ? (theme as Theme) : 'system'
  const cycle = useCallback(() => {
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
    setTheme(next)
  }, [current, setTheme])
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={cycle}
      aria-label={`Theme: ${current}. Click to change`}
      className="rounded-control border border-line p-2 text-slate hover:text-ink"
    >
      {ICON[current]}
    </button>
  )
}
```

`apps/web/src/components/shell/DeviceChip.tsx`:

```tsx
import type { ReactElement } from 'react'

export const DeviceChip = ({ label, testId }: { label: string | null; testId: string }): ReactElement => (
  <span data-testid={testId} className="hidden items-center gap-2 font-mono text-xs text-slate md:inline-flex">
    {label ? <><span>Station</span><b className="font-medium text-ink">{label}</b></> : <span>No station</span>}
  </span>
)
```

`apps/web/src/components/shell/TopNav.tsx`:

```tsx
'use client'

import { UserButton } from '@clerk/nextjs'
import { Menu } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

import { DeviceChip } from './DeviceChip'
import { MobileNav } from './MobileNav'
import { NAV_ITEMS } from './nav-items'
import { ThemeToggle } from './ThemeToggle'

export const TopNav = ({ testId, deviceLabel }: { testId: string; deviceLabel: string | null }): ReactElement => {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const openMenu = useCallback(() => setMenuOpen(true), [])

  return (
    <header data-testid={testId} className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex h-[60px] max-w-[1180px] items-center gap-6 px-6">
        <Link href="/dashboard" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span aria-hidden className="inline-block size-[22px] rounded-md bg-gradient-to-br from-sky to-sky/60" />
          Weather Station
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-1.5 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.key}
                href={item.href}
                data-testid={`${testId}-link-${item.key}`}
                aria-current={active ? 'page' : undefined}
                className={cn('relative rounded-control px-3 py-2 text-sm font-medium', active ? 'text-ink' : 'text-slate hover:text-ink')}
              >
                {item.label}
                {active ? (
                  <motion.span
                    layoutId="nav-indicator"
                    className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-sky"
                    transition={springs.snappy}
                  />
                ) : null}
              </Link>
            )
          })}
        </nav>
        <span className="flex-1" />
        <DeviceChip testId={`${testId}-device`} label={deviceLabel} />
        <ThemeToggle testId={`${testId}-theme`} />
        <UserButton />
        <button type="button" aria-label="Open menu" data-testid={`${testId}-menu`} onClick={openMenu} className="rounded-control border border-line p-2 md:hidden">
          <Menu className="size-4" aria-hidden />
        </button>
      </div>
      <MobileNav testId={`${testId}-mobile`} open={menuOpen} onOpenChange={setMenuOpen} deviceLabel={deviceLabel} />
    </header>
  )
}
```

`apps/web/src/components/shell/MobileNav.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/utils'

import { NAV_ITEMS } from './nav-items'

interface MobileNavProps { testId: string; open: boolean; onOpenChange: (open: boolean) => void; deviceLabel: string | null }

export const MobileNav = ({ testId, open, onOpenChange, deviceLabel }: MobileNavProps): ReactElement => {
  const pathname = usePathname()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  return (
    <Sheet testId={testId} open={open} onOpenChange={onOpenChange} title={deviceLabel ? `Station ${deviceLabel}` : 'Menu'}>
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            onClick={close}
            aria-current={pathname === item.href ? 'page' : undefined}
            className={cn('rounded-control px-3 py-2 text-sm font-medium', pathname === item.href ? 'bg-paper text-ink' : 'text-slate')}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </Sheet>
  )
}
```

`apps/web/src/components/shell/Footer.tsx`:

```tsx
import Link from 'next/link'
import type { ReactElement } from 'react'

export const Footer = ({ testId }: { testId: string }): ReactElement => (
  <footer data-testid={testId} className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-8 text-xs text-slate">
    <span>Weather Station</span>
    <Link href="/privacy" className="underline-offset-2 hover:underline">Privacy</Link>
  </footer>
)
```

`apps/web/src/components/shell/ShellSkeleton.tsx`:

```tsx
import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

export const ShellSkeleton = ({ testId }: { testId: string }): ReactElement => (
  <div data-testid={testId} className="mx-auto max-w-[1180px] px-6 py-8">
    <Skeleton testId={`${testId}-eyebrow`} className="mb-3 h-3 w-40" />
    <Skeleton testId={`${testId}-hero`} className="mb-8 h-24 w-64" />
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} testId={`${testId}-card-${i}`} className="h-[132px]" />)}
    </div>
  </div>
)
```

`apps/web/src/components/shell/EnsureUser.tsx`:

```tsx
'use client'

import { useUser } from '@clerk/nextjs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { useCallback, useEffect } from 'react'

import { ensureCurrentUserAction } from '@/actions/users.action'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { userKeys } from '@/services/users/users.queries'

import { ShellSkeleton } from './ShellSkeleton'

/**
 * Gate: children render only once the users row exists (MRP-19). Runs once
 * per Clerk user per session; the QueryProvider clears state on sign-out.
 */
export const EnsureUser = ({ children }: { children: ReactNode }): ReactElement => {
  const { user, isLoaded } = useUser()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: ['users', 'ensure', user?.id ?? null],
    mutationFn: ensureCurrentUserAction,
    onSuccess: (result) => {
      if (result.ok) void queryClient.invalidateQueries({ queryKey: userKeys.current })
    },
  })
  const { mutate, isIdle } = mutation

  useEffect(() => {
    if (isLoaded && user && isIdle) mutate()
  }, [isLoaded, user, isIdle, mutate])

  const retry = useCallback(() => mutate(), [mutate])

  if (!isLoaded || mutation.isPending || mutation.isIdle) return <ShellSkeleton testId="shell-skeleton" />

  if (mutation.isError || (mutation.data && !mutation.data.ok)) {
    const message = mutation.data && !mutation.data.ok ? mutation.data.message : 'Something went wrong preparing your account.'
    return (
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        <EmptyState testId="ensure-user-error" title="We couldn't set up your account" description={message} action={<Button testId="ensure-user-retry" onClick={retry}>Try again</Button>} />
      </div>
    )
  }

  return <>{children}</>
}
```

`apps/web/src/components/shell/AppShell.tsx`:

```tsx
'use client'

import type { ReactElement, ReactNode } from 'react'

import { useMyDevicesQuery } from '@/services/devices/devices.queries'

import { Footer } from './Footer'
import { TopNav } from './TopNav'

export const AppShell = ({ children, testId }: { children: ReactNode; testId: string }): ReactElement => {
  const { data: devices } = useMyDevicesQuery()
  const deviceLabel = devices?.[0]?.deviceId ?? null
  return (
    <div data-testid={testId} className="flex min-h-dvh flex-col">
      <TopNav testId={`${testId}-nav`} deviceLabel={deviceLabel} />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-16 pt-7">{children}</main>
      <Footer testId={`${testId}-footer`} />
    </div>
  )
}
```

`useMyDevicesQuery` is created in Task 10; if executing in order, create `services/devices/devices.queries.ts` in Task 10 first or temporarily pass `deviceLabel={null}` and wire it in Task 10 (preferred: do Task 10's service+hook first — no UI dependency).

`apps/web/src/app/(app)/layout.tsx`:

```tsx
import type { ReactElement, ReactNode } from 'react'

import { AppShell } from '@/components/shell/AppShell'
import { EnsureUser } from '@/components/shell/EnsureUser'

const AppLayout = ({ children }: { children: ReactNode }): ReactElement => (
  <EnsureUser>
    <AppShell testId="app-shell">{children}</AppShell>
  </EnsureUser>
)

export default AppLayout
```

`apps/web/src/app/(app)/template.tsx` (fade-in per route, no exit):

```tsx
'use client'

import { motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'

import { springs } from '@/components/motion/variants'

const AppTemplate = ({ children }: { children: ReactNode }): ReactElement => (
  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={springs.default}>
    {children}
  </motion.div>
)

export default AppTemplate
```

`apps/web/src/components/settings/AppearanceCard.tsx`:

```tsx
'use client'

import { useTheme } from 'next-themes'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export const AppearanceCard = ({ testId }: { testId: string }): ReactElement => {
  const { theme, setTheme } = useTheme()
  const choose = useCallback((value: string) => () => setTheme(value), [setTheme])
  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}><CardTitle testId={`${testId}-title`}>Appearance</CardTitle></CardHeader>
      <CardBody testId={`${testId}-body`}>
        <p className="mb-3 text-sm text-slate">Follows your system by default.</p>
        <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-control border border-line bg-paper p-1">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={theme === o.value}
              data-testid={`${testId}-${o.value}`}
              onClick={choose(o.value)}
              className={cn('rounded-[7px] px-3 py-1.5 text-[13px] font-medium', theme === o.value ? 'bg-card text-ink shadow-card' : 'text-slate')}
            >
              {o.label}
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
```

`apps/web/src/app/(app)/settings/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { AppearanceCard } from '@/components/settings/AppearanceCard'

export const metadata: Metadata = { title: 'Settings' }

const SettingsPage = (): ReactElement => (
  <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
    <AppearanceCard testId="settings-appearance" />
  </div>
)

export default SettingsPage
```

- [ ] **Step 4: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t shell && yarn lint && yarn check-types` — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shell apps/web/src/components/settings "apps/web/src/app/(app)" apps/web/tests/unit/components/shell
git commit -m "feat(web): app shell (nav, theme, mobile sheet), EnsureUser gate, settings appearance"
```

---

### Task 9: Migrations — Realtime publication + `claim_device` (pgTAP)

**Files:**
- Create: `infra/supabase-db/supabase/migrations/<ts>_enable_readings_realtime.sql`
- Create: `infra/supabase-db/supabase/migrations/<ts>_claim_device_fn.sql`
- Create: `infra/supabase-db/supabase/tests/realtime_publication.sql`, `claim_device.sql`
- Regenerate: `infra/supabase-db/src/types/database.ts`

**Interfaces (Produces):**
- Postgres: `public.claim_device(p_device_id text, p_user_id uuid) returns void` — raises `DEVICE_NOT_FOUND` / `DEVICE_ALREADY_CLAIMED`; idempotent for the same user; `service_role` only.
- `readings` is in `supabase_realtime`.
- Generated `Database['public']['Functions']['claim_device']` type.

- [ ] **Step 1: Write the pgTAP tests first**

`infra/supabase-db/supabase/tests/realtime_publication.sql`:

```sql
begin;
select plan(1);

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'readings'
  ),
  'readings is published to supabase_realtime'
);

select * from finish();
rollback;
```

`infra/supabase-db/supabase/tests/claim_device.sql`:

```sql
begin;
select plan(8);

insert into public.users (id, clerk_user_id) values
  ('00000000-0000-0000-0000-00000000000a', 'user_a'),
  ('00000000-0000-0000-0000-00000000000b', 'user_b');
insert into public.devices (device_id, secret, status) values ('WS-TEST1', 'secret', 'unregistered');

-- privileges
select ok(not has_function_privilege('anon', 'public.claim_device(text, uuid)', 'execute'), 'anon cannot execute claim_device');
select ok(not has_function_privilege('authenticated', 'public.claim_device(text, uuid)', 'execute'), 'authenticated cannot execute claim_device');
select ok(has_function_privilege('service_role', 'public.claim_device(text, uuid)', 'execute'), 'service_role can execute claim_device');

-- unknown device
select throws_ok(
  $$ select public.claim_device('WS-NOPE', '00000000-0000-0000-0000-00000000000a') $$,
  'P0001', 'DEVICE_NOT_FOUND', 'unknown device raises DEVICE_NOT_FOUND'
);

-- happy path
select lives_ok(
  $$ select public.claim_device('WS-TEST1', '00000000-0000-0000-0000-00000000000a') $$,
  'owner claims an unregistered device'
);
select ok(
  (select status from public.devices where device_id = 'WS-TEST1') = 'registered'
  and exists (select 1 from public.device_users where device_id = 'WS-TEST1' and user_id = '00000000-0000-0000-0000-00000000000a' and role = 'owner'),
  'device is registered and the user is owner'
);

-- idempotent for the same user
select lives_ok(
  $$ select public.claim_device('WS-TEST1', '00000000-0000-0000-0000-00000000000a') $$,
  'same user re-claiming is a no-op'
);

-- another user is rejected (OQ3: one device ↔ one account)
select throws_ok(
  $$ select public.claim_device('WS-TEST1', '00000000-0000-0000-0000-00000000000b') $$,
  'P0001', 'DEVICE_ALREADY_CLAIMED', 'second account cannot claim a registered device'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run to verify failure**

Run: `cd infra/supabase-db && yarn db-reset:local && yarn test:db` — Expected: the two new files FAIL (function missing, table not published).

- [ ] **Step 3: Migrations**

`yarn migrate:new enable_readings_realtime` →

```sql
-- MRP-25: the dashboard subscribes to postgres_changes on readings, filtered
-- by device_id. RLS ("device members can view readings") is applied to
-- Realtime deliveries for the authenticated role, so a subscriber only ever
-- receives rows for devices they are linked to.
alter publication supabase_realtime add table public.readings;
```

`yarn migrate:new claim_device_fn` →

```sql
-- MRP-22: atomic device claim. Locks the devices row so two accounts cannot
-- both register the same id (PRD OQ3). Called only from the registration
-- server action with the service-role client, hence service_role-only.
create or replace function public.claim_device(p_device_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_other_owner boolean;
begin
  select status into v_status
  from public.devices
  where device_id = p_device_id
  for update;

  if not found then
    raise exception 'DEVICE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.device_users
    where device_id = p_device_id and user_id is distinct from p_user_id
  ) into v_other_owner;

  if v_other_owner then
    raise exception 'DEVICE_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  insert into public.device_users (device_id, user_id, role)
  values (p_device_id, p_user_id, 'owner')
  on conflict (device_id, user_id) do nothing;

  update public.devices set status = 'registered'
  where device_id = p_device_id and status is distinct from 'registered';
end;
$$;

revoke execute on function public.claim_device(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_device(text, uuid) to service_role;
```

- [ ] **Step 4: Apply, regenerate types, run tests**

Run: `cd infra/supabase-db && yarn db-reset:local && yarn regenerate:types && yarn test:db` — all pgTAP files PASS. `git diff src/types/database.ts` shows `claim_device` under `Functions`.
Run the `rls-reviewer` agent on the two migrations before committing.

- [ ] **Step 5: Commit**

```bash
git add infra/supabase-db/supabase/migrations infra/supabase-db/supabase/tests infra/supabase-db/src/types/database.ts
git commit -m "feat(db): publish readings to realtime; claim_device() atomic registration (MRP-22/25)"
```

---

### Task 10: Devices service, `registerDeviceAction`, registration page (MRP-22)

**Files:**
- Create: `apps/web/src/services/devices/devices.service.ts`, `devices.queries.ts`
- Create: `apps/web/src/actions/devices.action.ts`
- Create: `apps/web/src/components/devices/RegisterDeviceForm.tsx`
- Create: `apps/web/src/app/(app)/devices/register/page.tsx`
- Test: `apps/web/tests/unit/services/devices/devices.service.test.ts`, `apps/web/tests/unit/actions/devices.action.test.ts`, `apps/web/tests/unit/components/devices/RegisterDeviceForm.test.tsx`, `apps/web/tests/integration/services/devices/devices.service.integration.test.ts`

**Interfaces (Produces):**
```ts
export interface MyDevice { deviceId: string; role: DeviceRole; addedAt: string; device: { status: string; createdAt: string } | null }
export const fetchMyDevices = (supabase): Promise<MyDevice[]>          // ordered by added_at asc
export const deviceKeys = { all: ['devices'] as const, mine: ['devices', 'mine'] as const }
export const useMyDevicesQuery = (): UseQueryResult<MyDevice[]>
export const registerDeviceAction = (input: { deviceId: string }): Promise<ActionResult<{ deviceId: string }>>
// codes: UNAUTHORIZED | INVALID_INPUT | DEVICE_NOT_FOUND | DEVICE_ALREADY_CLAIMED | UNKNOWN
export const normalizeDeviceId = (raw: string): string   // trim + uppercase
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/services/devices/devices.service.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchMyDevices } from '@/services/devices/devices.service'

const makeClient = (result: { data: unknown; error: unknown }) => {
  const chain = { select: jest.fn(() => chain), order: jest.fn(async () => result) }
  return { from: jest.fn(() => chain), chain } as unknown as SupabaseClient<Database> & { chain: typeof chain }
}

describe('fetchMyDevices', () => {
  it('selects device links with nested device fields, ordered by added_at', async () => {
    const rows = [{ deviceId: 'WS-1', role: 'owner', addedAt: 't', device: { status: 'registered', createdAt: 'c' } }]
    const client = makeClient({ data: rows, error: null })
    await expect(fetchMyDevices(client)).resolves.toEqual(rows)
    expect(client.chain.select).toHaveBeenCalledWith('deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at )')
    expect(client.chain.order).toHaveBeenCalledWith('added_at', { ascending: true })
  })
})
```

`apps/web/tests/unit/actions/devices.action.test.ts`:

```ts
const auth = jest.fn()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const ensure = jest.fn()
jest.mock('@/actions/users.action', () => ({ ensureCurrentUserAction: () => ensure() }))
const rpc = jest.fn()
jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }))

import { normalizeDeviceId, registerDeviceAction } from '@/actions/devices.action'

describe('registerDeviceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    ensure.mockResolvedValue({ ok: true, data: { userId: 'uuid-1' } })
  })

  it('normalizes ids', () => {
    expect(normalizeDeviceId('  ws-7f3a ')).toBe('WS-7F3A')
  })

  it('rejects empty input with a field error', async () => {
    const res = await registerDeviceAction({ deviceId: '   ' })
    expect(res).toMatchObject({ ok: false, code: 'INVALID_INPUT', fieldErrors: { deviceId: expect.any(String) } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('claims via RPC with the internal user id', async () => {
    rpc.mockResolvedValue({ error: null })
    await expect(registerDeviceAction({ deviceId: 'ws-7f3a' })).resolves.toEqual({ ok: true, data: { deviceId: 'WS-7F3A' } })
    expect(rpc).toHaveBeenCalledWith('claim_device', { p_device_id: 'WS-7F3A', p_user_id: 'uuid-1' })
  })

  it.each([
    ['DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND'],
    ['DEVICE_ALREADY_CLAIMED', 'DEVICE_ALREADY_CLAIMED'],
    ['something else', 'UNKNOWN'],
  ])('maps SQL error "%s" to %s', async (message, code) => {
    rpc.mockResolvedValue({ error: { message, code: 'P0001', details: null } })
    await expect(registerDeviceAction({ deviceId: 'WS-1' })).resolves.toMatchObject({ ok: false, code })
  })
})
```

`apps/web/tests/unit/components/devices/RegisterDeviceForm.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { routerState } from '../../../stubs/next-navigation'

const register = jest.fn()
jest.mock('@/actions/devices.action', () => ({ registerDeviceAction: (i: unknown) => register(i) }))
const toast = jest.fn()
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
const invalidate = jest.fn()
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }))

import { RegisterDeviceForm } from '@/components/devices/RegisterDeviceForm'

describe('RegisterDeviceForm', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows the not-found error inline', async () => {
    register.mockResolvedValue({ ok: false, code: 'DEVICE_NOT_FOUND', message: "We don't recognise that ID — check the label", fieldErrors: { deviceId: "We don't recognise that ID — check the label" } })
    const user = userEvent.setup()
    render(<RegisterDeviceForm testId="reg" />)
    await user.type(screen.getByTestId('reg-input'), 'ws-nope')
    await user.click(screen.getByTestId('reg-submit'))
    await waitFor(() => expect(screen.getByTestId('reg-field-error')).toHaveTextContent("don't recognise"))
  })

  it('redirects to the dashboard on success', async () => {
    register.mockResolvedValue({ ok: true, data: { deviceId: 'WS-7F3A' } })
    const user = userEvent.setup()
    render(<RegisterDeviceForm testId="reg" />)
    await user.type(screen.getByTestId('reg-input'), 'ws-7f3a')
    await user.click(screen.getByTestId('reg-submit'))
    await waitFor(() => expect(routerState.replace).toHaveBeenCalledWith('/dashboard'))
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Station registered' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['devices'] })
  })
})
```

Integration test `devices.service.integration.test.ts`: seed device + link for user A with the service client; `fetchMyDevices` as A returns one row with `role: 'owner'`; as B returns `[]`; `claim_device` RPC via service client for B on A's device rejects with `DEVICE_ALREADY_CLAIMED`.

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t "fetchMyDevices|registerDeviceAction|RegisterDeviceForm"` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/services/devices/devices.service.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeviceRole } from '@ws/shared'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface MyDevice {
  deviceId: string
  role: DeviceRole
  addedAt: string
  device: { status: string; createdAt: string } | null
}

/** Devices the current user is linked to (RLS on device_users + devices). Oldest link first. */
export const fetchMyDevices = async (supabase: SupabaseClient<Database>): Promise<MyDevice[]> => {
  const { data, error } = await supabase
    .from('device_users')
    .select('deviceId:device_id, role, addedAt:added_at, device:devices ( status, createdAt:created_at )')
    .order('added_at', { ascending: true })

  if (error) {
    throw new ServiceError(`Failed to fetch devices: ${error.message}`, error.code, error.details)
  }
  return (data ?? []) as MyDevice[]
}
```

The cast narrows the generated `role: string` to `DeviceRole` (the DB check constraint guarantees it — see the comment in the init migration).

`apps/web/src/services/devices/devices.queries.ts`:

```ts
'use client'

import { useUser } from '@clerk/nextjs'
import { useQuery } from '@tanstack/react-query'

import { useSupabaseClient } from '@/lib/supabase'

import { fetchMyDevices } from './devices.service'

export const deviceKeys = {
  all: ['devices'] as const,
  mine: ['devices', 'mine'] as const,
}

export const useMyDevicesQuery = () => {
  const client = useSupabaseClient()
  const { isSignedIn } = useUser()
  return useQuery({
    queryKey: deviceKeys.mine,
    queryFn: () => fetchMyDevices(client),
    enabled: !!isSignedIn,
  })
}
```

`apps/web/src/actions/devices.action.ts`:

```ts
'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'

import { ensureCurrentUserAction } from './users.action'

export const normalizeDeviceId = (raw: string): string => raw.trim().toUpperCase()

const inputSchema = z.object({ deviceId: z.string().transform(normalizeDeviceId).pipe(z.string().min(3).max(64)) })

const MESSAGES = {
  DEVICE_NOT_FOUND: "We don't recognise that ID — check the label",
  DEVICE_ALREADY_CLAIMED: 'This station is already linked to another account',
} as const

/**
 * Web device registration (PRD W2/B2, MRP-22): validate → ensure users row →
 * claim_device() RPC (atomic; owner link + status flip). Idempotent per user.
 */
export const registerDeviceAction = async (input: { deviceId: string }): Promise<ActionResult<{ deviceId: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return actionError('INVALID_INPUT', 'Enter the ID printed on your station', { deviceId: 'Enter the ID printed on your station' })
  }
  const deviceId = parsed.data.deviceId

  const ensured = await ensureCurrentUserAction()
  if (!ensured.ok) return actionError(ensured.code, ensured.message)

  const service = createServiceRoleClient()
  const { error } = await service.rpc('claim_device', { p_device_id: deviceId, p_user_id: ensured.data.userId })

  if (error) {
    if (error.message.includes('DEVICE_NOT_FOUND')) {
      return actionError('DEVICE_NOT_FOUND', MESSAGES.DEVICE_NOT_FOUND, { deviceId: MESSAGES.DEVICE_NOT_FOUND })
    }
    if (error.message.includes('DEVICE_ALREADY_CLAIMED')) {
      return actionError('DEVICE_ALREADY_CLAIMED', MESSAGES.DEVICE_ALREADY_CLAIMED, { deviceId: MESSAGES.DEVICE_ALREADY_CLAIMED })
    }
    console.error('registerDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not register the station. Try again.')
  }
  return actionOk({ deviceId })
}
```

`apps/web/src/components/devices/RegisterDeviceForm.tsx`:

```tsx
'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { registerDeviceAction } from '@/actions/devices.action'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

export const RegisterDeviceForm = ({ testId }: { testId: string }): ReactElement => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  const onChange = useCallback((e: FormEvent<HTMLInputElement>) => setDeviceId(e.currentTarget.value), [])

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setPending(true)
      setError(undefined)
      const result = await registerDeviceAction({ deviceId })
      setPending(false)
      if (!result.ok) {
        setError(result.fieldErrors?.deviceId ?? result.message)
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['devices'] })
      toast({ title: 'Station registered', description: `${result.data.deviceId} is now yours.`, tone: 'success' })
      router.replace('/dashboard')
    },
    [deviceId, queryClient, router, toast],
  )

  return (
    <Card testId={testId} className="mx-auto w-full max-w-md">
      <CardBody testId={`${testId}-body`} className="pt-6">
        <h1 className="text-xl font-semibold tracking-tight">Register your station</h1>
        <p className="mb-5 mt-1 text-sm text-slate">Enter the ID printed on the label under the device.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field testId={`${testId}-field`} label="Station ID" htmlFor="device-id" error={error} hint="Looks like WS-7F3A">
            <Input testId={`${testId}-input`} id="device-id" mono placeholder="WS-XXXX" autoComplete="off" value={deviceId} onChange={onChange} invalid={!!error} />
          </Field>
          <Button testId={`${testId}-submit`} type="submit" loading={pending} disabled={deviceId.trim().length === 0}>
            Register device
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
```

`apps/web/src/app/(app)/devices/register/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { RegisterDeviceForm } from '@/components/devices/RegisterDeviceForm'

export const metadata: Metadata = { title: 'Register a station' }

const RegisterDevicePage = (): ReactElement => (
  <div className="py-10">
    <RegisterDeviceForm testId="register-device" />
  </div>
)

export default RegisterDevicePage
```

Now wire `AppShell` (Task 8) to `useMyDevicesQuery` if it was stubbed.

- [ ] **Step 4: Run tests, lint, types, integration**

Run: `yarn workspace @ws/web test:unit -t "fetchMyDevices|registerDeviceAction|RegisterDeviceForm" && yarn lint && yarn check-types` — PASS.
Run: `yarn workspace @ws/web test:integration -t devices` (local Supabase up) — PASS.
Manual: register a provisioned device id (`yarn workspace @ws/supabase-db provision:device`), see the toast and the redirect; try again → still ok; try with a second account → inline "already linked" error.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/devices apps/web/src/actions/devices.action.ts apps/web/src/components/devices "apps/web/src/app/(app)/devices" apps/web/src/components/shell/AppShell.tsx apps/web/tests
git commit -m "feat(web): device registration — service, claim action, form + page (MRP-22)"
```

---

### Task 11: Readings service + hooks + Realtime; parameter registry, format & chart libs

**Files:**
- Modify: `apps/web/src/services/readings/readings.service.ts` (add `fetchReadingsRange`, `fetchReadingsHistory`)
- Create: `apps/web/src/services/readings/readings.queries.ts`, `readings.realtime.ts`
- Create: `apps/web/src/lib/parameters.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/chart.ts`
- Test: `apps/web/tests/unit/services/readings/readings.service.test.ts` (extend/create), `readings.realtime.test.tsx`, `apps/web/tests/unit/lib/{parameters,format,chart}.test.ts`, `apps/web/tests/integration/services/readings/readings.service.integration.test.ts` (extend)

**Interfaces (Produces):**
```ts
// lib/parameters.ts
export type ParameterKey = 'temperature' | 'humidity' | 'pressure' | 'windSpeed' | 'windDirection' | 'precipitation'
export interface ParameterMeta { key: ParameterKey; label: string; unit: string; decimals: number; accent: CardAccent; cssVar: string }
export const PARAMETERS: readonly ParameterMeta[]      // in display order: temperature, humidity, pressure, windSpeed, windDirection, precipitation
export const parameterMeta = (key: ParameterKey): ParameterMeta
// lib/format.ts
export const formatTime = (iso: string, opts?: { timeZone?: string }): string      // "12:35"
export const formatDateTime = (iso: string): string                                // "15 Aug, 12:35"
export const formatRelative = (iso: string, now?: Date): string                    // "2 min ago", "just now"
export const bearingToCompass = (deg: number): string                             // 16-point: "NW"
export const readingAgeMs = (iso: string, now?: Date): number
// lib/chart.ts
export type HistoryRange = '24h' | '7d' | '30d'
export const RANGE_MS: Record<HistoryRange, number>
export const rangeWindow = (range: HistoryRange, now?: Date): { from: string; to: string }   // ISO strings
export interface HistoryPoint { t: number; temperature: number | null; humidity: number | null; pressure: number | null; windSpeed: number | null; windDirection: number | null; precipitation: number | null }
export const toHistoryPoints = (readings: Reading[]): HistoryPoint[]
export const withGaps = (points: HistoryPoint[], maxGapMs: number): HistoryPoint[]  // inserts an all-null point after any gap > maxGapMs
export interface Trend { delta: number; direction: 'up' | 'down' | 'flat' }
export const trendFor = (points: HistoryPoint[], key: ParameterKey, windowMs: number, now?: Date, flatBelow?: number): Trend | null
export const lastN = (points: HistoryPoint[], windowMs: number, now?: Date): HistoryPoint[]
// services/readings
export const fetchReadingsRange = (supabase, { deviceId, from, to }): Promise<Reading[]>          // asc, limit 2000
export const fetchReadingsHistory = (supabase, { deviceId, range }): Promise<Reading[]>          // 24h → range; 7d/30d → throws ServiceError('RANGE_NOT_SUPPORTED') until Plan 2
export const readingKeys = { all, latest(deviceId), history(deviceId, range) }
export const useLatestReadingQuery = (deviceId?: string)
export const useReadingsHistoryQuery = (deviceId: string | undefined, range: HistoryRange)
export type RealtimeStatus = 'idle' | 'live' | 'reconnecting' | 'offline'
export const useReadingsRealtime = (deviceId?: string): { status: RealtimeStatus; lastEventAt: number | null }
```

- [ ] **Step 1: Failing tests (libs)**

`apps/web/tests/unit/lib/format.test.ts`:

```ts
import { bearingToCompass, formatRelative, readingAgeMs } from '@/lib/format'

describe('format', () => {
  it('maps bearings to 16-point compass', () => {
    expect(bearingToCompass(0)).toBe('N')
    expect(bearingToCompass(315)).toBe('NW')
    expect(bearingToCompass(348.75)).toBe('N')
    expect(bearingToCompass(101)).toBe('E')
  })
  it('formats relative time', () => {
    const now = new Date('2026-08-15T12:37:00Z')
    expect(formatRelative('2026-08-15T12:36:40Z', now)).toBe('just now')
    expect(formatRelative('2026-08-15T12:35:00Z', now)).toBe('2 min ago')
    expect(formatRelative('2026-08-15T10:35:00Z', now)).toBe('2 h ago')
    expect(readingAgeMs('2026-08-15T12:35:00Z', now)).toBe(120_000)
  })
})
```

`apps/web/tests/unit/lib/chart.test.ts`:

```ts
import type { Reading } from '@ws/shared'

import { lastN, rangeWindow, toHistoryPoints, trendFor, withGaps } from '@/lib/chart'

const r = (iso: string, temperature: number): Reading => ({
  id: 1, deviceId: 'WS-1', timestamp: iso, temperature, humidity: 50, pressure: 1013, windSpeed: null, windDirection: null, precipitation: null,
})

describe('chart', () => {
  it('rangeWindow spans the range ending now', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    expect(rangeWindow('24h', now)).toEqual({ from: '2026-08-14T12:00:00.000Z', to: '2026-08-15T12:00:00.000Z' })
  })
  it('withGaps inserts a null point after a gap larger than the threshold', () => {
    const pts = toHistoryPoints([r('2026-08-15T10:00:00Z', 20), r('2026-08-15T10:05:00Z', 21), r('2026-08-15T11:00:00Z', 22)])
    const out = withGaps(pts, 10 * 60_000)
    expect(out).toHaveLength(4)
    expect(out[2]).toMatchObject({ temperature: null })
    expect(out[2]?.t).toBeGreaterThan(pts[1]!.t)
    expect(out[2]?.t).toBeLessThan(pts[2]!.t)
  })
  it('trendFor compares now against ~window ago', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    const pts = toHistoryPoints([r('2026-08-15T09:00:00Z', 20.8), r('2026-08-15T11:55:00Z', 21.4)])
    expect(trendFor(pts, 'temperature', 3 * 3_600_000, now)).toEqual({ delta: 0.6, direction: 'up' })
    expect(trendFor(pts, 'temperature', 3 * 3_600_000, now, 1)).toEqual({ delta: 0.6, direction: 'flat' })
    expect(trendFor(pts.slice(1), 'temperature', 3 * 3_600_000, now)).toBeNull()
  })
  it('lastN keeps points within the window', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    const pts = toHistoryPoints([r('2026-08-15T08:00:00Z', 1), r('2026-08-15T11:00:00Z', 2)])
    expect(lastN(pts, 3 * 3_600_000, now)).toHaveLength(1)
  })
})
```

`apps/web/tests/unit/lib/parameters.test.ts`:

```ts
import { PARAMETERS, parameterMeta } from '@/lib/parameters'

describe('parameters', () => {
  it('lists six parameters in display order with units', () => {
    expect(PARAMETERS.map((p) => p.key)).toEqual(['temperature', 'humidity', 'pressure', 'windSpeed', 'windDirection', 'precipitation'])
    expect(parameterMeta('pressure')).toMatchObject({ unit: 'hPa', decimals: 1, accent: 'press' })
  })
})
```

- [ ] **Step 2: Failing tests (services + realtime)**

`apps/web/tests/unit/services/readings/readings.service.test.ts` — add:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchReadingsHistory, fetchReadingsRange } from '@/services/readings/readings.service'

const makeClient = (result: { data: unknown; error: unknown }) => {
  const chain = {
    select: jest.fn(() => chain), eq: jest.fn(() => chain), gte: jest.fn(() => chain), lte: jest.fn(() => chain),
    order: jest.fn(() => chain), limit: jest.fn(async () => result),
  }
  return { from: jest.fn(() => chain), chain } as unknown as SupabaseClient<Database> & { chain: typeof chain }
}

describe('fetchReadingsRange', () => {
  it('filters by device and timestamp window using the index, ascending, capped', async () => {
    const client = makeClient({ data: [], error: null })
    await fetchReadingsRange(client, { deviceId: 'WS-1', from: '2026-08-14T12:00:00.000Z', to: '2026-08-15T12:00:00.000Z' })
    expect(client.chain.eq).toHaveBeenCalledWith('device_id', 'WS-1')
    expect(client.chain.gte).toHaveBeenCalledWith('timestamp', '2026-08-14T12:00:00.000Z')
    expect(client.chain.lte).toHaveBeenCalledWith('timestamp', '2026-08-15T12:00:00.000Z')
    expect(client.chain.order).toHaveBeenCalledWith('timestamp', { ascending: true })
    expect(client.chain.limit).toHaveBeenCalledWith(2000)
  })
})

describe('fetchReadingsHistory', () => {
  it('rejects ranges Plan 1 does not support yet', async () => {
    const client = makeClient({ data: [], error: null })
    await expect(fetchReadingsHistory(client, { deviceId: 'WS-1', range: '7d' })).rejects.toMatchObject({ code: 'RANGE_NOT_SUPPORTED' })
  })
})
```

`apps/web/tests/unit/services/readings/readings.realtime.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

type Handler = (payload: { new: Record<string, unknown> }) => void
type StatusCb = (status: string) => void
const fake = { handler: null as Handler | null, statusCb: null as StatusCb | null, removed: false, setAuth: jest.fn() }
const channel = {
  on: jest.fn((_e: string, _f: unknown, h: Handler) => { fake.handler = h; return channel }),
  subscribe: jest.fn((cb: StatusCb) => { fake.statusCb = cb; return channel }),
}
const client = { channel: jest.fn(() => channel), removeChannel: jest.fn(() => { fake.removed = true }), realtime: { setAuth: fake.setAuth } }
jest.mock('@/lib/supabase', () => ({ useSupabaseClient: () => client }))

import { useReadingsRealtime } from '@/services/readings/readings.realtime'
import { readingKeys } from '@/services/readings/readings.queries'

describe('useReadingsRealtime', () => {
  it('upserts latest + 24h history on INSERT and invalidates on reconnect', async () => {
    const qc = new QueryClient()
    qc.setQueryData(readingKeys.history('WS-1', '24h'), [])
    const invalidate = jest.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const { result, unmount } = renderHook(() => useReadingsRealtime('WS-1'), { wrapper })

    await act(async () => { fake.statusCb?.('SUBSCRIBED') })
    expect(result.current.status).toBe('live')
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ event: 'INSERT', table: 'readings', filter: 'device_id=eq.WS-1' }), expect.any(Function))

    await act(async () => {
      fake.handler?.({ new: { id: 9, device_id: 'WS-1', timestamp: '2026-08-15T12:35:00Z', temperature: 21.4, humidity: 58, pressure: 1013.2, wind_speed: null, wind_direction: null, precipitation: null } })
    })
    expect(qc.getQueryData(readingKeys.latest('WS-1'))).toMatchObject({ id: 9, deviceId: 'WS-1', temperature: 21.4 })
    expect(qc.getQueryData(readingKeys.history('WS-1', '24h'))).toHaveLength(1)

    await act(async () => { fake.statusCb?.('CHANNEL_ERROR') })
    expect(result.current.status).toBe('reconnecting')
    await act(async () => { fake.statusCb?.('SUBSCRIBED') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: readingKeys.latest('WS-1') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [...readingKeys.all, 'history', 'WS-1'] })

    unmount()
    expect(fake.removed).toBe(true)
  })
})
```

- [ ] **Step 3: Run to verify failure** — `yarn workspace @ws/web test:unit -t "format|chart|parameters|fetchReadings|useReadingsRealtime"` → FAIL.

- [ ] **Step 4: Implement libs**

`apps/web/src/lib/parameters.ts`:

```ts
import type { CardAccent } from '@/components/ui/Card'

export type ParameterKey = 'temperature' | 'humidity' | 'pressure' | 'windSpeed' | 'windDirection' | 'precipitation'

export interface ParameterMeta {
  key: ParameterKey
  label: string
  unit: string
  decimals: number
  accent: CardAccent
  cssVar: string
}

/** Display order and presentation for every sensor parameter (spec §4.2). */
export const PARAMETERS: readonly ParameterMeta[] = [
  { key: 'temperature', label: 'Temperature', unit: '°C', decimals: 1, accent: 'temp', cssVar: 'var(--color-temp)' },
  { key: 'humidity', label: 'Humidity', unit: '%', decimals: 0, accent: 'hum', cssVar: 'var(--color-hum)' },
  { key: 'pressure', label: 'Pressure', unit: 'hPa', decimals: 1, accent: 'press', cssVar: 'var(--color-press)' },
  { key: 'windSpeed', label: 'Wind', unit: 'km/h', decimals: 0, accent: 'wind', cssVar: 'var(--color-wind)' },
  { key: 'windDirection', label: 'Wind direction', unit: '°', decimals: 0, accent: 'wind', cssVar: 'var(--color-wind)' },
  { key: 'precipitation', label: 'Precipitation', unit: 'mm', decimals: 1, accent: 'rain', cssVar: 'var(--color-rain)' },
] as const

const BY_KEY = new Map(PARAMETERS.map((p) => [p.key, p]))
export const parameterMeta = (key: ParameterKey): ParameterMeta => BY_KEY.get(key)!
```

`apps/web/src/lib/format.ts`:

```ts
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const

export const bearingToCompass = (deg: number): string => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]

export const formatTime = (iso: string, opts: { timeZone?: string } = {}): string =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: opts.timeZone }).format(new Date(iso))

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

export const readingAgeMs = (iso: string, now: Date = new Date()): number => now.getTime() - new Date(iso).getTime()

/** Coarse relative label for the freshness eyebrow ("just now", "2 min ago", "2 h ago"). */
export const formatRelative = (iso: string, now: Date = new Date()): string => {
  const ms = readingAgeMs(iso, now)
  if (ms < 45_000) return 'just now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
```

`apps/web/src/lib/chart.ts`:

```ts
import type { Reading } from '@ws/shared'

import type { ParameterKey } from './parameters'

export type HistoryRange = '24h' | '7d' | '30d'

const HOUR = 3_600_000
export const RANGE_MS: Record<HistoryRange, number> = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR }

export const rangeWindow = (range: HistoryRange, now: Date = new Date()): { from: string; to: string } => ({
  from: new Date(now.getTime() - RANGE_MS[range]).toISOString(),
  to: now.toISOString(),
})

export interface HistoryPoint {
  t: number
  temperature: number | null
  humidity: number | null
  pressure: number | null
  windSpeed: number | null
  windDirection: number | null
  precipitation: number | null
}

const NULL_POINT = (t: number): HistoryPoint => ({ t, temperature: null, humidity: null, pressure: null, windSpeed: null, windDirection: null, precipitation: null })

export const toHistoryPoints = (readings: Reading[]): HistoryPoint[] =>
  readings.map((r) => ({
    t: new Date(r.timestamp).getTime(),
    temperature: r.temperature, humidity: r.humidity, pressure: r.pressure,
    windSpeed: r.windSpeed, windDirection: r.windDirection, precipitation: r.precipitation,
  }))

/** Insert an all-null point after any gap larger than maxGapMs so Recharts draws a gap, not a line. */
export const withGaps = (points: HistoryPoint[], maxGapMs: number): HistoryPoint[] => {
  const out: HistoryPoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const prev = points[i - 1]
    if (prev && p.t - prev.t > maxGapMs) out.push(NULL_POINT(prev.t + 1))
    out.push(p)
  }
  return out
}

export const lastN = (points: HistoryPoint[], windowMs: number, now: Date = new Date()): HistoryPoint[] => {
  const cutoff = now.getTime() - windowMs
  return points.filter((p) => p.t >= cutoff)
}

export interface Trend { delta: number; direction: 'up' | 'down' | 'flat' }

/** Latest value vs the value closest to `windowMs` ago; null when there is no earlier point. */
export const trendFor = (points: HistoryPoint[], key: ParameterKey, windowMs: number, now: Date = new Date(), flatBelow = 0.05): Trend | null => {
  const valid = points.filter((p) => p[key] !== null)
  if (valid.length < 2) return null
  const latest = valid[valid.length - 1]!
  const target = now.getTime() - windowMs
  let ref = valid[0]!
  for (const p of valid) {
    if (Math.abs(p.t - target) < Math.abs(ref.t - target)) ref = p
  }
  if (ref === latest) return null
  const delta = Math.round(((latest[key] as number) - (ref[key] as number)) * 100) / 100
  const direction = Math.abs(delta) < flatBelow ? 'flat' : delta > 0 ? 'up' : 'down'
  return { delta, direction }
}
```

- [ ] **Step 5: Implement services + hooks + realtime**

Append to `apps/web/src/services/readings/readings.service.ts`:

```ts
import type { HistoryRange } from '@/lib/chart'
import { rangeWindow } from '@/lib/chart'

const READING_COLUMNS =
  'id, deviceId:device_id, timestamp, temperature, humidity, pressure, windSpeed:wind_speed, windDirection:wind_direction, precipitation'

/** Raw readings in [from, to] for one device, ascending. Uses the (device_id, timestamp DESC) index. */
export const fetchReadingsRange = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; from: string; to: string },
): Promise<Reading[]> => {
  const { data, error } = await supabase
    .from('readings')
    .select(READING_COLUMNS)
    .eq('device_id', params.deviceId)
    .gte('timestamp', params.from)
    .lte('timestamp', params.to)
    .order('timestamp', { ascending: true })
    .limit(2000)

  if (error) {
    throw new ServiceError(`Failed to fetch readings range: ${error.message}`, error.code, error.details)
  }
  return data ?? []
}

/** History for a chart range. 24h = raw rows; 7d/30d switch to the bucketed RPC in Plan 2 (MRP-34). */
export const fetchReadingsHistory = async (
  supabase: SupabaseClient<Database>,
  params: { deviceId: string; range: HistoryRange },
): Promise<Reading[]> => {
  if (params.range !== '24h') {
    throw new ServiceError(`Range ${params.range} is not available yet`, 'RANGE_NOT_SUPPORTED')
  }
  return fetchReadingsRange(supabase, { deviceId: params.deviceId, ...rangeWindow(params.range) })
}
```

(Refactor the existing `fetchLatestReading` to use `READING_COLUMNS` too.)

`apps/web/src/services/readings/readings.queries.ts`:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'

import type { HistoryRange } from '@/lib/chart'
import { useSupabaseClient } from '@/lib/supabase'

import { fetchLatestReading, fetchReadingsHistory } from './readings.service'

export const readingKeys = {
  all: ['readings'] as const,
  latest: (deviceId: string) => [...readingKeys.all, 'latest', deviceId] as const,
  history: (deviceId: string, range: HistoryRange) => [...readingKeys.all, 'history', deviceId, range] as const,
}

export const useLatestReadingQuery = (deviceId: string | undefined) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: readingKeys.latest(deviceId ?? ''),
    queryFn: () => fetchLatestReading(client, { deviceId: deviceId! }),
    enabled: !!deviceId,
  })
}

export const useReadingsHistoryQuery = (deviceId: string | undefined, range: HistoryRange) => {
  const client = useSupabaseClient()
  return useQuery({
    queryKey: readingKeys.history(deviceId ?? '', range),
    queryFn: () => fetchReadingsHistory(client, { deviceId: deviceId!, range }),
    enabled: !!deviceId,
    // Realtime keeps 24h fresh; still refetch on focus so gaps after sleep close quickly.
    refetchOnWindowFocus: true,
  })
}
```

`apps/web/src/services/readings/readings.realtime.ts`:

```ts
'use client'

import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import type { Reading } from '@ws/shared'
import type { Database } from '@ws/supabase-db'
import { useEffect, useRef, useState } from 'react'

import { useSupabaseClient } from '@/lib/supabase'

import { readingKeys } from './readings.queries'

export type RealtimeStatus = 'idle' | 'live' | 'reconnecting' | 'offline'
type ReadingRow = Database['public']['Tables']['readings']['Row']

const toReading = (row: ReadingRow): Reading => ({
  id: row.id,
  deviceId: row.device_id,
  timestamp: row.timestamp,
  temperature: Number(row.temperature),
  humidity: row.humidity === null ? null : Number(row.humidity),
  pressure: Number(row.pressure),
  windSpeed: row.wind_speed === null ? null : Number(row.wind_speed),
  windDirection: row.wind_direction === null ? null : Number(row.wind_direction),
  precipitation: row.precipitation === null ? null : Number(row.precipitation),
})

/**
 * Subscribes to INSERTs on readings for one device (MRP-25). New rows are
 * written straight into the TanStack cache (latest + 24h history); after a
 * reconnect the queries are invalidated to fill any gap.
 */
export const useReadingsRealtime = (deviceId: string | undefined): { status: RealtimeStatus; lastEventAt: number | null } => {
  const client = useSupabaseClient()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const wasSubscribed = useRef(false)

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false

    const channel = client
      .channel(`readings:${deviceId}`)
      .on<ReadingRow>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'readings', filter: `device_id=eq.${deviceId}` },
        (payload: RealtimePostgresInsertPayload<ReadingRow>) => {
          const reading = toReading(payload.new)
          queryClient.setQueryData<Reading | null>(readingKeys.latest(deviceId), reading)
          queryClient.setQueryData<Reading[] | undefined>(readingKeys.history(deviceId, '24h'), (prev) =>
            prev === undefined ? prev : prev.some((r) => r.id === reading.id) ? prev : [...prev, reading],
          )
          setLastEventAt(Date.now())
        },
      )

    const start = async () => {
      await client.realtime.setAuth()
      if (cancelled) return
      channel.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          if (wasSubscribed.current) {
            void queryClient.invalidateQueries({ queryKey: readingKeys.latest(deviceId) })
            void queryClient.invalidateQueries({ queryKey: [...readingKeys.all, 'history', deviceId] })
          }
          wasSubscribed.current = true
          setStatus('live')
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          setStatus('reconnecting')
        } else if (s === 'CLOSED') {
          setStatus('offline')
        }
      })
    }
    void start()

    return () => {
      cancelled = true
      void client.removeChannel(channel)
    }
  }, [client, deviceId, queryClient])

  return { status, lastEventAt }
}
```

Note: `client.realtime.setAuth()` with no argument makes supabase-js call the `accessToken` callback (Clerk JWT); it also re-runs it on heartbeat, keeping the socket authorised past Clerk's 60 s token lifetime.

- [ ] **Step 6: Integration test additions**

Extend `readings.service.integration.test.ts`: seed 3 readings across 2 hours; `fetchReadingsRange` as a member returns them ascending; as a non-member returns `[]`; `fetchReadingsHistory('7d')` rejects with `RANGE_NOT_SUPPORTED`.

- [ ] **Step 7: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t "format|chart|parameters|fetchReadings|useReadingsRealtime" && yarn lint && yarn check-types && yarn workspace @ws/web test:integration -t readings` — PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib apps/web/src/services/readings apps/web/tests
git commit -m "feat(web): readings range/history services, hooks, Realtime subscription; parameter/format/chart libs (MRP-25/27)"
```

---

### Task 12: Dashboard — conditions strip, parameter cards, states, page (MRP-25)

**Files:**
- Create: `apps/web/src/components/charts/Sparkline.tsx`
- Create: `apps/web/src/components/dashboard/{TrendGlyph,CompassGlyph,ParameterCard,ParameterCardGrid,ConditionsStrip,NoDeviceState,WaitingForReading,DashboardSkeleton}.tsx`
- Create: `apps/web/src/components/dashboard/useDashboardData.ts`
- Create: `apps/web/src/app/(app)/dashboard/page.tsx`, `apps/web/src/components/dashboard/DashboardView.tsx`
- Test: `apps/web/tests/unit/components/dashboard/dashboard.test.tsx`

**Interfaces:**
- Consumes: `useMyDevicesQuery`, `useLatestReadingQuery`, `useReadingsHistoryQuery`, `useReadingsRealtime`, `PARAMETERS`, `toHistoryPoints`, `lastN`, `trendFor`, `formatRelative`, `formatTime`, `bearingToCompass`, `NumberRoll`, `FreshnessPulse`, `Card`, `EmptyState`, `Skeleton`, `Button`, `fadeUp`, `stagger`.
- Produces:
```ts
export const Sparkline = ({ points: HistoryPoint[], dataKey: ParameterKey, color: string, testId, dashed?: boolean }): ReactElement
export const TrendGlyph = ({ trend: Trend | null, decimals: number, unit?: string, testId }): ReactElement
export const CompassGlyph = ({ bearing: number, testId }): ReactElement
export const ParameterCard = ({ meta: ParameterMeta, value: number | null, points: HistoryPoint[], trend: Trend | null, testId }): ReactElement
export const ParameterCardGrid = ({ latest: Reading, points: HistoryPoint[], now: Date, testId }): ReactElement
export const ConditionsStrip = ({ latest: Reading, points: HistoryPoint[], status: RealtimeStatus, now: Date, testId }): ReactElement
export const NoDeviceState = ({ testId }): ReactElement
export const WaitingForReading = ({ deviceId: string, status: RealtimeStatus, testId }): ReactElement
export const DashboardSkeleton = ({ testId }): ReactElement
export const useDashboardData = (): { isLoading: boolean; deviceId: string | null; latest: Reading | null; readings: Reading[]; points: HistoryPoint[]; status: RealtimeStatus; now: Date; error: unknown }
export const DashboardView = ({ testId }): ReactElement   // client component composing everything
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/dashboard/dashboard.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import type { Reading } from '@ws/shared'

jest.mock('@clerk/nextjs', () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true }) }))
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  LineChart: ({ children }: { children: unknown }) => <svg>{children as never}</svg>,
  Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}))

const state = { isLoading: false, deviceId: 'WS-7F3A' as string | null, latest: null as Reading | null, readings: [] as Reading[], points: [] as never[], status: 'live' as const, now: new Date('2026-08-15T12:37:00Z'), error: null }
jest.mock('@/components/dashboard/useDashboardData', () => ({ useDashboardData: () => state }))

import { ConditionsStrip } from '@/components/dashboard/ConditionsStrip'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ParameterCard } from '@/components/dashboard/ParameterCard'
import { parameterMeta } from '@/lib/parameters'

const latest: Reading = { id: 1, deviceId: 'WS-7F3A', timestamp: '2026-08-15T12:35:00Z', temperature: 21.4, humidity: 58, pressure: 1013.2, windSpeed: null, windDirection: null, precipitation: null }

describe('dashboard', () => {
  it('shows the skeleton while loading', () => {
    state.isLoading = true
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-skeleton')).toBeInTheDocument()
    state.isLoading = false
  })

  it('shows the no-device state when the user has no station', () => {
    state.deviceId = null
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-no-device')).toHaveTextContent('No station yet')
    expect(screen.getByTestId('dash-no-device-register')).toHaveAttribute('href', '/devices/register')
    state.deviceId = 'WS-7F3A'
  })

  it('shows waiting state when a device exists but has no readings', () => {
    state.latest = null
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-waiting')).toHaveTextContent('Waiting for the first reading')
  })

  it('renders the conditions strip with values, freshness and not-fitted cards', () => {
    render(<ConditionsStrip testId="strip" latest={latest} points={[]} status="live" now={new Date('2026-08-15T12:37:00Z')} />)
    expect(screen.getByTestId('strip-hero')).toHaveTextContent('21.4')
    expect(screen.getByTestId('strip-eyebrow')).toHaveTextContent('2 min ago')
    render(<ParameterCard testId="card" meta={parameterMeta('precipitation')} value={null} points={[]} trend={null} />)
    expect(screen.getByTestId('card')).toHaveAttribute('data-fitted', 'false')
    expect(screen.getByTestId('card')).toHaveTextContent('Sensor not fitted')
  })
})
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t dashboard` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/components/charts/Sparkline.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'

import type { HistoryPoint } from '@/lib/chart'
import type { ParameterKey } from '@/lib/parameters'

interface SparklineProps { points: HistoryPoint[]; dataKey: ParameterKey; color: string; testId: string; dashed?: boolean }

export const Sparkline = ({ points, dataKey, color, testId, dashed = false }: SparklineProps): ReactElement => (
  <div data-testid={testId} className="h-7 w-full" aria-hidden>
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 200, height: 28 }}>
      <LineChart data={points} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} strokeDasharray={dashed ? '2 3' : undefined} />
      </LineChart>
    </ResponsiveContainer>
  </div>
)
```

`apps/web/src/components/dashboard/TrendGlyph.tsx`:

```tsx
import type { ReactElement } from 'react'

import type { Trend } from '@/lib/chart'
import { formatNumber } from '@/lib/number-format'
import { cn } from '@/lib/utils'

const GLYPH = { up: '▴', down: '▾', flat: '—' } as const

export const TrendGlyph = ({ trend, decimals, unit, testId }: { trend: Trend | null; decimals: number; unit?: string; testId: string }): ReactElement => {
  if (!trend) return <span data-testid={testId} className="text-xs text-slate">—</span>
  return (
    <span data-testid={testId} data-direction={trend.direction} className={cn('inline-flex items-center gap-1 text-xs font-medium', trend.direction === 'up' ? 'text-temp' : trend.direction === 'down' ? 'text-rain' : 'text-slate')}>
      {GLYPH[trend.direction]} {formatNumber(Math.abs(trend.delta), decimals)}{unit ? ` ${unit}` : ''}
    </span>
  )
}
```

`apps/web/src/components/dashboard/CompassGlyph.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'

import { springs } from '@/components/motion/variants'

/** Needle rotated to the bearing (0° = N, clockwise). */
export const CompassGlyph = ({ bearing, testId }: { bearing: number; testId: string }): ReactElement => (
  <svg data-testid={testId} viewBox="0 0 40 40" className="size-10" aria-hidden>
    <circle cx="20" cy="20" r="17" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
    <motion.g style={{ originX: '20px', originY: '20px' }} animate={{ rotate: bearing }} transition={springs.default}>
      <path d="M20 5 L24 20 L20 17 L16 20 Z" fill="var(--color-wind)" />
      <path d="M20 35 L24 20 L20 23 L16 20 Z" fill="var(--color-line)" />
    </motion.g>
  </svg>
)
```

`apps/web/src/components/dashboard/ParameterCard.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'

import { Sparkline } from '@/components/charts/Sparkline'
import { NumberRoll } from '@/components/motion/NumberRoll'
import { Card } from '@/components/ui/Card'
import type { HistoryPoint, Trend } from '@/lib/chart'
import { bearingToCompass } from '@/lib/format'
import type { ParameterMeta } from '@/lib/parameters'
import { cn } from '@/lib/utils'

import { CompassGlyph } from './CompassGlyph'
import { TrendGlyph } from './TrendGlyph'

interface ParameterCardProps { meta: ParameterMeta; value: number | null; points: HistoryPoint[]; trend: Trend | null; testId: string }

export const ParameterCard = ({ meta, value, points, trend, testId }: ParameterCardProps): ReactElement => {
  const fitted = value !== null
  return (
    <Card testId={testId} accent={meta.accent} data-fitted={fitted} className={cn('p-4 pb-3', !fitted && 'opacity-55')}>
      <div className="text-[11px] uppercase tracking-[0.08em] text-slate">{meta.label}</div>
      <div className="mt-2 flex items-end gap-1">
        {meta.key === 'windDirection' && fitted ? (
          <div className="flex items-center gap-2">
            <CompassGlyph testId={`${testId}-compass`} bearing={value} />
            <span className="readout text-[32px] leading-none">{bearingToCompass(value)}</span>
          </div>
        ) : (
          <NumberRoll testId={`${testId}-value`} value={value} decimals={meta.decimals} className="text-[32px] leading-none" />
        )}
        <span className="pb-0.5 text-[13px] font-medium text-slate">{meta.unit}</span>
      </div>
      <div className="mt-2">
        <Sparkline testId={`${testId}-spark`} points={points} dataKey={meta.key} color={meta.cssVar} dashed={!fitted} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-slate">
        <span>{fitted ? 'last 3 h' : 'Sensor not fitted'}</span>
        {fitted ? <TrendGlyph testId={`${testId}-trend`} trend={trend} decimals={meta.decimals} /> : null}
      </div>
    </Card>
  )
}
```

`apps/web/src/components/dashboard/ParameterCardGrid.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { Reading } from '@ws/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { fadeUp, stagger } from '@/components/motion/variants'
import type { HistoryPoint } from '@/lib/chart'
import { lastN, trendFor } from '@/lib/chart'
import { PARAMETERS } from '@/lib/parameters'

import { ParameterCard } from './ParameterCard'

const THREE_HOURS = 3 * 3_600_000

export const ParameterCardGrid = ({ latest, points, now, testId }: { latest: Reading; points: HistoryPoint[]; now: Date; testId: string }): ReactElement => {
  const recent = useMemo(() => lastN(points, THREE_HOURS, now), [points, now])
  const cards = useMemo(
    () => PARAMETERS.map((meta) => ({ meta, value: latest[meta.key], trend: trendFor(recent, meta.key, THREE_HOURS, now) })),
    [latest, recent, now],
  )
  return (
    <motion.section data-testid={testId} variants={stagger} initial="hidden" animate="visible" className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
      {cards.map(({ meta, value, trend }) => (
        <motion.div key={meta.key} variants={fadeUp} layout>
          <ParameterCard testId={`${testId}-${meta.key}`} meta={meta} value={value} points={recent} trend={trend} />
        </motion.div>
      ))}
    </motion.section>
  )
}
```

`apps/web/src/components/dashboard/ConditionsStrip.tsx`:

```tsx
'use client'

import type { Reading } from '@ws/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { NumberRoll } from '@/components/motion/NumberRoll'
import type { HistoryPoint } from '@/lib/chart'
import { lastN, trendFor } from '@/lib/chart'
import { bearingToCompass, formatRelative, formatTime, readingAgeMs } from '@/lib/format'
import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'

import { TrendGlyph } from './TrendGlyph'

const THREE_HOURS = 3 * 3_600_000
const STALE_AFTER_MS = 3 * DEFAULT_SEND_INTERVAL_MS

interface ConditionsStripProps { latest: Reading; points: HistoryPoint[]; status: RealtimeStatus; now: Date; testId: string }

export const ConditionsStrip = ({ latest, points, status, now, testId }: ConditionsStripProps): ReactElement => {
  const stale = readingAgeMs(latest.timestamp, now) > STALE_AFTER_MS
  const pulseStatus = stale ? 'stale' : status === 'live' ? 'live' : status === 'reconnecting' ? 'reconnecting' : 'offline'
  const recent = useMemo(() => lastN(points, THREE_HOURS, now), [points, now])
  const trends = useMemo(
    () => ({
      humidity: trendFor(recent, 'humidity', THREE_HOURS, now),
      pressure: trendFor(recent, 'pressure', THREE_HOURS, now, 0.3),
    }),
    [recent, now],
  )
  const dayMin = useMemo(() => Math.min(...points.map((p) => p.temperature ?? Infinity)), [points])
  const dayMax = useMemo(() => Math.max(...points.map((p) => p.temperature ?? -Infinity)), [points])

  return (
    <section data-testid={testId} className="grid grid-cols-1 items-end gap-6 border-b border-line pb-7 md:grid-cols-[auto_1fr] md:gap-10">
      <div>
        <div data-testid={`${testId}-eyebrow`} className="mb-1.5 flex items-center gap-2 font-mono text-xs text-slate">
          <FreshnessPulse testId={`${testId}-pulse`} status={pulseStatus} pulseKey={latest.id} />
          <span>{stale ? `No reading for ${formatRelative(latest.timestamp, now).replace(' ago', '')}` : `Updated ${formatTime(latest.timestamp)} · ${formatRelative(latest.timestamp, now)}`}</span>
          {status === 'reconnecting' ? <span className="text-wind">· reconnecting</span> : null}
        </div>
        <div className="flex items-start gap-1.5">
          <NumberRoll testId={`${testId}-hero`} value={latest.temperature} decimals={1} className="readout-hero text-[88px] leading-[0.9] md:text-[112px]" />
          <span className="mt-3 text-[28px] font-medium text-slate">°C</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-9 gap-y-4 pb-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-slate">Humidity</span>
          <span className="readout text-[26px] leading-none">{latest.humidity === null ? '—' : latest.humidity.toFixed(0)}<small className="ml-1 text-[13px] font-medium text-slate">%</small></span>
          <TrendGlyph testId={`${testId}-hum-trend`} trend={trends.humidity} decimals={0} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-slate">Pressure</span>
          <span className="readout text-[26px] leading-none">{latest.pressure.toFixed(1)}<small className="ml-1 text-[13px] font-medium text-slate">hPa</small></span>
          <TrendGlyph testId={`${testId}-press-trend`} trend={trends.pressure} decimals={1} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-slate">Wind</span>
          <span className="readout text-[26px] leading-none">
            {latest.windSpeed === null ? '—' : latest.windSpeed.toFixed(0)}
            <small className="ml-1 text-[13px] font-medium text-slate">km/h{latest.windDirection === null ? '' : ` ${bearingToCompass(latest.windDirection)}`}</small>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-slate">Rain today</span>
          <span className="readout text-[26px] leading-none">{latest.precipitation === null ? '—' : latest.precipitation.toFixed(1)}<small className="ml-1 text-[13px] font-medium text-slate">mm</small></span>
        </div>
        {Number.isFinite(dayMin) && Number.isFinite(dayMax) ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-slate">24 h range</span>
            <span className="readout text-[26px] leading-none">{dayMin.toFixed(1)}<small className="mx-1 text-[13px] text-slate">–</small>{dayMax.toFixed(1)}<small className="ml-1 text-[13px] font-medium text-slate">°C</small></span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
```

`apps/web/src/components/dashboard/NoDeviceState.tsx`:

```tsx
import { Radio } from 'lucide-react'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { EmptyState } from '@/components/ui/EmptyState'

export const NoDeviceState = ({ testId }: { testId: string }): ReactElement => (
  <EmptyState
    testId={testId}
    icon={<Radio className="size-8" aria-hidden />}
    title="No station yet"
    description="Register the station from the ID printed on its label and readings will start arriving here."
    action={
      <Link data-testid={`${testId}-register`} href="/devices/register" className="inline-flex h-10 items-center rounded-control bg-ink px-4 text-sm font-semibold text-paper">
        Register a device
      </Link>
    }
  />
)
```

`apps/web/src/components/dashboard/WaitingForReading.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { EmptyState } from '@/components/ui/EmptyState'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'

export const WaitingForReading = ({ deviceId, status, testId }: { deviceId: string; status: RealtimeStatus; testId: string }): ReactElement => (
  <EmptyState
    testId={testId}
    icon={<FreshnessPulse testId={`${testId}-pulse`} status={status === 'live' ? 'live' : 'reconnecting'} />}
    title="Waiting for the first reading"
    description={`${deviceId} is registered. Your station posts every 5 minutes — the first reading will appear here the moment it arrives.`}
  />
)
```

`apps/web/src/components/dashboard/DashboardSkeleton.tsx`:

```tsx
import type { ReactElement } from 'react'

import { Skeleton } from '@/components/ui/Skeleton'

export const DashboardSkeleton = ({ testId }: { testId: string }): ReactElement => (
  <div data-testid={testId} className="flex flex-col gap-6">
    <div className="border-b border-line pb-7">
      <Skeleton testId={`${testId}-eyebrow`} className="mb-3 h-3 w-44" />
      <Skeleton testId={`${testId}-hero`} className="h-24 w-72" />
    </div>
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
      {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} testId={`${testId}-card-${i}`} className="h-[132px]" />)}
    </div>
    <Skeleton testId={`${testId}-chart`} className="h-64" />
  </div>
)
```

`apps/web/src/components/dashboard/useDashboardData.ts`:

```ts
'use client'

import { useUser } from '@clerk/nextjs'
import type { Reading } from '@ws/shared'
import { useEffect, useMemo, useState } from 'react'

import type { HistoryPoint } from '@/lib/chart'
import { toHistoryPoints } from '@/lib/chart'
import { useMyDevicesQuery } from '@/services/devices/devices.queries'
import { useLatestReadingQuery, useReadingsHistoryQuery } from '@/services/readings/readings.queries'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'
import { useReadingsRealtime } from '@/services/readings/readings.realtime'

export interface DashboardData {
  isLoading: boolean
  deviceId: string | null
  latest: Reading | null
  readings: Reading[]
  points: HistoryPoint[]
  status: RealtimeStatus
  now: Date
  error: unknown
}

/** One hook per page: devices → first device → latest + 24h history + realtime. `now` ticks every 30 s for relative labels. */
export const useDashboardData = (): DashboardData => {
  const { isLoaded: isUserLoaded } = useUser()
  const devices = useMyDevicesQuery()
  const deviceId = devices.data?.[0]?.deviceId ?? null
  const latest = useLatestReadingQuery(deviceId ?? undefined)
  const history = useReadingsHistoryQuery(deviceId ?? undefined, '24h')
  const { status } = useReadingsRealtime(deviceId ?? undefined)

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const readings = useMemo(() => history.data ?? [], [history.data])
  const points = useMemo(() => toHistoryPoints(readings), [readings])

  const isLoading = !isUserLoaded || devices.isLoading || (deviceId !== null && (latest.isLoading || history.isLoading))

  return {
    isLoading,
    deviceId,
    latest: latest.data ?? null,
    readings,
    points,
    status,
    now,
    error: devices.error ?? latest.error ?? history.error ?? null,
  }
}
```

`apps/web/src/components/dashboard/DashboardView.tsx`:

```tsx
'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement } from 'react'

import { fade } from '@/components/motion/variants'
import { EmptyState } from '@/components/ui/EmptyState'

import { ConditionsStrip } from './ConditionsStrip'
import { DashboardSkeleton } from './DashboardSkeleton'
import { NoDeviceState } from './NoDeviceState'
import { ParameterCardGrid } from './ParameterCardGrid'
import { useDashboardData } from './useDashboardData'
import { WaitingForReading } from './WaitingForReading'

export const DashboardView = ({ testId }: { testId: string }): ReactElement => {
  const { isLoading, deviceId, latest, points, status, now, error } = useDashboardData()

  if (isLoading) return <DashboardSkeleton testId={`${testId}-skeleton`} />
  if (error) return <EmptyState testId={`${testId}-error`} title="Couldn't load your station" description="Check your connection and reload the page." />

  return (
    <AnimatePresence mode="wait">
      {deviceId === null ? (
        <motion.div key="no-device" variants={fade} initial="hidden" animate="visible" exit="exit"><NoDeviceState testId={`${testId}-no-device`} /></motion.div>
      ) : latest === null ? (
        <motion.div key="waiting" variants={fade} initial="hidden" animate="visible" exit="exit"><WaitingForReading testId={`${testId}-waiting`} deviceId={deviceId} status={status} /></motion.div>
      ) : (
        <motion.div key="data" variants={fade} initial="hidden" animate="visible" exit="exit" className="flex flex-col gap-6">
          <ConditionsStrip testId={`${testId}-strip`} latest={latest} points={points} status={status} now={now} />
          <ParameterCardGrid testId={`${testId}-cards`} latest={latest} points={points} now={now} />
          <div data-testid={`${testId}-charts-slot`} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

`apps/web/src/app/(app)/dashboard/page.tsx`:

```tsx
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { DashboardView } from '@/components/dashboard/DashboardView'

export const metadata: Metadata = { title: 'Dashboard' }

const DashboardPage = (): ReactElement => <DashboardView testId="dashboard" />

export default DashboardPage
```

- [ ] **Step 4: Run tests, lint, types**

Run: `yarn workspace @ws/web test:unit -t dashboard && yarn lint && yarn check-types` — PASS.
Manual: with a registered device and the ingest curl from `docs/superpowers/plans/2026-07-21-mrp-12-readings-ingest.md`, POST a reading and watch the hero roll and the pulse fire within 1 s without a refresh.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/charts/Sparkline.tsx apps/web/src/components/dashboard "apps/web/src/app/(app)/dashboard" apps/web/tests/unit/components/dashboard
git commit -m "feat(web): dashboard — conditions strip, parameter cards, empty/waiting states, live updates (MRP-25)"
```

---

### Task 13: 24-hour charts per parameter (MRP-27)

**Files:**
- Create: `apps/web/src/components/charts/{ParameterChart,ChartTooltip,ChartPanel,ChartSection}.tsx`, `apps/web/src/components/charts/useChartData.ts`
- Modify: `apps/web/src/components/dashboard/DashboardView.tsx` (replace the charts slot with `<ChartSection>`)
- Test: `apps/web/tests/unit/components/charts/useChartData.test.ts`, `apps/web/tests/unit/components/charts/ParameterChart.test.tsx`

**Interfaces (Produces):**
```ts
export const useChartData = (points: HistoryPoint[], range: HistoryRange): { data: HistoryPoint[]; domain: [number, number]; ticks: number[] }
export const ParameterChart = ({ meta: ParameterMeta, points: HistoryPoint[], range: HistoryRange, testId, height?: number }): ReactElement
export const ChartPanel = ({ meta, points, range, testId }): ReactElement   // Card + header (label, unit, min · max) + ParameterChart
export const ChartSection = ({ latest: Reading, points: HistoryPoint[], range: HistoryRange, testId }): ReactElement  // one panel per fitted parameter (Plan 2 adds the RangeSelector here)
```

- [ ] **Step 1: Failing tests**

`apps/web/tests/unit/components/charts/useChartData.test.ts`:

```ts
/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react'

import { useChartData } from '@/components/charts/useChartData'
import type { HistoryPoint } from '@/lib/chart'

const p = (iso: string, temperature: number): HistoryPoint => ({ t: new Date(iso).getTime(), temperature, humidity: null, pressure: null, windSpeed: null, windDirection: null, precipitation: null })

describe('useChartData', () => {
  it('adds gap points and produces a domain covering the range with 5 ticks', () => {
    const points = [p('2026-08-15T10:00:00Z', 20), p('2026-08-15T10:05:00Z', 21), p('2026-08-15T11:00:00Z', 22)]
    const { result } = renderHook(() => useChartData(points, '24h'))
    expect(result.current.data).toHaveLength(4)
    expect(result.current.ticks).toHaveLength(5)
    expect(result.current.domain[1] - result.current.domain[0]).toBe(24 * 3_600_000)
  })
})
```

`apps/web/tests/unit/components/charts/ParameterChart.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { ParameterChart } from '@/components/charts/ParameterChart'
import { parameterMeta } from '@/lib/parameters'

describe('ParameterChart', () => {
  it('renders an SVG line chart at a fixed size (jsdom has no layout)', () => {
    const now = Date.now()
    const points = Array.from({ length: 12 }, (_, i) => ({ t: now - (11 - i) * 300_000, temperature: 20 + i / 10, humidity: null, pressure: null, windSpeed: null, windDirection: null, precipitation: null }))
    render(<ParameterChart testId="chart" meta={parameterMeta('temperature')} points={points} range="24h" width={600} height={200} />)
    expect(screen.getByTestId('chart')).toBeInTheDocument()
    expect(screen.getByTestId('chart').querySelector('svg')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `yarn workspace @ws/web test:unit -t "useChartData|ParameterChart"` → FAIL.

- [ ] **Step 3: Implement**

`apps/web/src/components/charts/useChartData.ts`:

```ts
'use client'

import { useMemo } from 'react'

import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { RANGE_MS, withGaps } from '@/lib/chart'
import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'

const GAP_FACTOR = 2

/** Chart-ready series: gaps inserted, x-domain = full range ending at the newest point (or now), 5 evenly spaced ticks. */
export const useChartData = (points: HistoryPoint[], range: HistoryRange): { data: HistoryPoint[]; domain: [number, number]; ticks: number[] } =>
  useMemo(() => {
    const end = points.length ? points[points.length - 1]!.t : Date.now()
    const start = end - RANGE_MS[range]
    const bucketMs = range === '24h' ? DEFAULT_SEND_INTERVAL_MS : range === '7d' ? 3_600_000 : 6 * 3_600_000
    const data = withGaps(points, bucketMs * GAP_FACTOR)
    const ticks = [0, 1, 2, 3, 4].map((i) => start + (i * RANGE_MS[range]) / 4)
    return { data, domain: [start, end], ticks }
  }, [points, range])
```

`apps/web/src/components/charts/ChartTooltip.tsx`:

```tsx
import type { ReactElement } from 'react'

import { formatDateTime } from '@/lib/format'
import { formatNumber } from '@/lib/number-format'
import type { ParameterMeta } from '@/lib/parameters'

interface ChartTooltipProps { active?: boolean; payload?: Array<{ value: number | null; payload: { t: number } }>; meta: ParameterMeta; testId: string }

export const ChartTooltip = ({ active, payload, meta, testId }: ChartTooltipProps): ReactElement | null => {
  const item = payload?.[0]
  if (!active || !item || item.value === null || item.value === undefined) return null
  return (
    <div data-testid={testId} className="rounded-control border border-line bg-card px-2.5 py-1.5 shadow-card">
      <div className="font-mono text-[11px] text-slate">{formatDateTime(new Date(item.payload.t).toISOString())}</div>
      <div className="readout text-base">{formatNumber(item.value, meta.decimals)} <span className="text-xs font-medium text-slate">{meta.unit}</span></div>
    </div>
  )
}
```

`apps/web/src/components/charts/ParameterChart.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { springs } from '@/components/motion/variants'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { formatTime } from '@/lib/format'
import type { ParameterMeta } from '@/lib/parameters'

import { ChartTooltip } from './ChartTooltip'
import { useChartData } from './useChartData'

interface ParameterChartProps { meta: ParameterMeta; points: HistoryPoint[]; range: HistoryRange; testId: string; height?: number; width?: number }

interface DotProps { cx?: number; cy?: number; index?: number; value?: number | null }

export const ParameterChart = ({ meta, points, range, testId, height = 220, width }: ParameterChartProps): ReactElement => {
  const { data, domain, ticks } = useChartData(points, range)
  const lastIndex = data.length - 1

  // Only the newest point gets a dot — and it animates in ("the reading arrives").
  const renderDot = useCallback(
    (props: DotProps): ReactElement => {
      if (props.index !== lastIndex || props.cx === undefined || props.cy === undefined || props.value === null || props.value === undefined) {
        return <g key={`dot-${props.index ?? 'x'}`} />
      }
      return (
        <g key={`dot-${props.index}-${points[lastIndex]?.t ?? 0}`}>
          <motion.circle cx={props.cx} cy={props.cy} r={9} fill={meta.cssVar} opacity={0.18} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springs.default} style={{ transformOrigin: `${props.cx}px ${props.cy}px` }} />
          <motion.circle cx={props.cx} cy={props.cy} r={4} fill={meta.cssVar} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={springs.default} style={{ transformOrigin: `${props.cx}px ${props.cy}px` }} />
        </g>
      )
    },
    [lastIndex, meta.cssVar, points],
  )

  const tickFormatter = useCallback((t: number) => formatTime(new Date(t).toISOString()), [])
  const tooltip = useCallback((p: { active?: boolean; payload?: Array<{ value: number | null; payload: { t: number } }> }) => <ChartTooltip {...p} meta={meta} testId={`${testId}-tooltip`} />, [meta, testId])

  const chart = (
    <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }} width={width} height={width ? height : undefined}>
      <XAxis dataKey="t" type="number" scale="time" domain={domain} ticks={ticks} tickFormatter={tickFormatter} tick={{ fontSize: 11, fill: 'var(--color-slate)', fontFamily: 'var(--font-mono)' }} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} minTickGap={24} />
      <YAxis width={44} domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--color-slate)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickCount={4} />
      <Tooltip content={tooltip} cursor={{ stroke: 'var(--color-line)' }} isAnimationActive={false} />
      <Line type="monotone" dataKey={meta.key} stroke={meta.cssVar} strokeWidth={2} dot={renderDot} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
    </LineChart>
  )

  return (
    <div data-testid={testId} style={{ height }} className="w-full">
      {width ? chart : (
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          {chart}
        </ResponsiveContainer>
      )}
    </div>
  )
}
```

`apps/web/src/components/charts/ChartPanel.tsx`:

```tsx
'use client'

import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { formatNumber } from '@/lib/number-format'
import type { ParameterMeta } from '@/lib/parameters'

import { ParameterChart } from './ParameterChart'

export const ChartPanel = ({ meta, points, range, testId }: { meta: ParameterMeta; points: HistoryPoint[]; range: HistoryRange; testId: string }): ReactElement => {
  const { min, max } = useMemo(() => {
    let min = Infinity, max = -Infinity
    for (const p of points) { const v = p[meta.key]; if (v !== null) { if (v < min) min = v; if (v > max) max = v } }
    return { min, max }
  }, [points, meta.key])
  return (
    <Card testId={testId}>
      <CardHeader testId={`${testId}-header`}>
        <CardTitle testId={`${testId}-title`}>{meta.label}</CardTitle>
        <span className="inline-flex items-center gap-1.5 text-xs text-slate"><i className="inline-block h-[3px] w-2.5 rounded" style={{ background: meta.cssVar }} />{meta.unit}</span>
        {Number.isFinite(min) ? <span className="font-mono text-xs text-slate">min {formatNumber(min, meta.decimals)} · max {formatNumber(max, meta.decimals)}</span> : null}
        <span className="flex-1" />
        <div data-testid={`${testId}-range-slot`} />
      </CardHeader>
      <CardBody testId={`${testId}-body`}>
        <ParameterChart testId={`${testId}-chart`} meta={meta} points={points} range={range} />
      </CardBody>
    </Card>
  )
}
```

`apps/web/src/components/charts/ChartSection.tsx`:

```tsx
'use client'

import { motion } from 'motion/react'
import type { Reading } from '@ws/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { fadeUp, stagger } from '@/components/motion/variants'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { PARAMETERS } from '@/lib/parameters'

import { ChartPanel } from './ChartPanel'

/** One chart panel per parameter the device reports (null in the latest reading = not fitted). Wind direction is not charted. */
export const ChartSection = ({ latest, points, range, testId }: { latest: Reading; points: HistoryPoint[]; range: HistoryRange; testId: string }): ReactElement => {
  const metas = useMemo(() => PARAMETERS.filter((m) => m.key !== 'windDirection' && latest[m.key] !== null), [latest])
  return (
    <motion.section data-testid={testId} variants={stagger} initial="hidden" animate="visible" className="flex flex-col gap-4">
      {metas.map((meta) => (
        <motion.div key={meta.key} variants={fadeUp}>
          <ChartPanel testId={`${testId}-${meta.key}`} meta={meta} points={points} range={range} />
        </motion.div>
      ))}
    </motion.section>
  )
}
```

In `DashboardView.tsx` replace `<div data-testid={`${testId}-charts-slot`} />` with `<ChartSection testId={`${testId}-charts`} latest={latest} points={points} range="24h" />` (import it).

- [ ] **Step 4: Run tests, lint, types; visual check**

Run: `yarn workspace @ws/web test:unit && yarn lint && yarn check-types` — PASS.
Manual (dev server, real device or curl inserts): three chart panels; tooltip shows value + local time; a 20-minute gap in data renders as a gap; a new reading extends the line and the newest dot scales in; on a 375 px viewport panels stack and x-ticks stay legible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/charts apps/web/src/components/dashboard/DashboardView.tsx apps/web/tests/unit/components/charts
git commit -m "feat(web): 24-hour parameter charts with tooltip, gaps and live newest point (MRP-27)"
```

---

### Task 14: Supabase/Clerk config, docs, E2E verification (MRP-32), final gate

**Files:**
- Modify: `infra/supabase-db/supabase/config.toml` (uncomment `[auth.third_party.clerk]`, set the dev domain)
- Modify: `apps/web/.env.example` (already extended in Task 6 — verify), `README.md`, `CLAUDE.md` (env table: Clerk routing vars)
- Create: `docs/superpowers/verification/2026-MM-DD-mrp-32-web-onboarding.md`

- [ ] **Step 1: Supabase third-party auth (local + prod)**

Local `config.toml`:

```toml
[auth.third_party.clerk]
enabled = true
domain = "<your-app>.clerk.accounts.dev"   # from Clerk dashboard → API keys → Frontend API
```

Prod: Supabase dashboard → Authentication → Sign In / Providers → Third-party auth → Clerk (same domain). Clerk dashboard → Sessions → Customize session token → `{"role": "authenticated"}`. Then `cd infra/supabase-db && yarn db-reset:local`.

- [ ] **Step 2: Docs**

- `CLAUDE.md` Environment Variables table: add `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` (Client). Add one line under "Supabase Clients": Realtime subscriptions use the same browser client; `readings` is in the `supabase_realtime` publication and RLS filters deliveries.
- `README.md`: "Web dashboard" section — how to run locally with Infisical, the Clerk `role` claim requirement, and the mockup/spec links.

- [ ] **Step 3: Realtime token soak**

Leave the dashboard open ≥ 3 minutes (Clerk token TTL is 60 s) while posting readings every 30 s with the ingest curl; every reading must appear without refresh. Then put the laptop to sleep 2 min, wake: eyebrow shows "reconnecting" then "live" and the missed readings appear (invalidate on re-subscribe). Record both results in the verification doc.

- [ ] **Step 4: MRP-32 Flow 1 verification (real device, preview deployment)**

Write `docs/superpowers/verification/2026-MM-DD-mrp-32-web-onboarding.md` with a table of the ticket's ACs and results:

| Check | Result | Notes |
| --- | --- | --- |
| Fresh account: sign-up → dashboard shows "No station yet" | | |
| Register device-id → toast → "Waiting for the first reading" | | |
| First reading visible ≤ 15 s after device POST (target < 1 s via Realtime) | | measured with a stopwatch against the device serial log |
| Total onboarding time from first visit to live data | | must be < 10 min |
| 24 h chart correct after a day of data (gaps render as gaps) | | |
| Second account cannot register the same device (inline error) nor see its data (dashboard empty) | | |
| Findings & follow-up tickets | | file new Linear issues in Phase 2 |

- [ ] **Step 5: Final gate**

Run from repo root: `yarn format && yarn lint && yarn check-types && yarn test:unit && yarn workspace @ws/web test:integration && (cd infra/supabase-db && yarn test:db) && yarn build` — all green. Run the `data-path-reviewer` agent over `apps/web/src`.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "docs: Clerk/Supabase third-party auth config, web dashboard docs, MRP-32 verification"
git push -u origin feature/web-mvp-ui
```

Open a PR to `dev` titled "Web dashboard MVP — auth, registration, live dashboard, 24 h charts (MRP-17/19/22/25/27/32)"; link the spec, plan, and verification doc; move the six Linear tickets to In Review.
