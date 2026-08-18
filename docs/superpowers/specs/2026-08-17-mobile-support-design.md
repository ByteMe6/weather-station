# Mobile support — design

**Date:** 2026-08-17
**Status:** approved for planning

## 1. Goal

Every route in the web app is usable on a phone (390 px) and a tablet (768 px):
nothing scrolls sideways, nothing is clipped off the right edge, and every
control is big enough to hit with a thumb. A Playwright suite proves it and
keeps proving it, so the next feature cannot quietly regress it.

Not a goal: a distinct mobile design, native app shells, offline support,
gesture navigation, or re-thinking the information architecture per breakpoint.
This is "the existing design, correct at every width" — not a redesign.

## 2. Current state

Mobile support is **partial and uneven**, not absent. Measured on 2026-08-17:

Already adapts:

- `TopNav` hides the primary nav at `md` and opens a `MobileNav` drawer from a
  hamburger.
- `ParameterCardGrid`, `ConditionsStrip`, `DashboardSkeleton` and
  `ShellSkeleton` all carry `md:` / `xl:` grid variants.
- `ScheduleRow`, `AdminUsersTable` and `DeviceHeader` use `flex-wrap`, so they
  wrap instead of overflowing.
- `Dialog` is already `w-[min(92vw,480px)]`.
- `/sign-in` and `/sign-up` are Clerk's own components — verified correct at
  390 px, nothing for us to do.

Gaps:

- **85 of 93 `.tsx` components carry no breakpoint at all**; only 8 files use
  one, 16 prefix usages in total.
- `MembersList.tsx:62` — a non-wrapping flex row with six children (avatar,
  name/handle stack, "you" badge, spacer, role `Select`, Remove button). The
  member email added in `b79dccc` lengthened that row further.
- Hard `grid-cols-2` field pairs: `ScheduleDialog:96`, `ExportDialog:103`,
  `DeviceProfileDialog:133`.
- A flat `px-6` gutter at every width, in five shell files: `AppShell:54`,
  `TopNav:50`, `Footer:7`, `ShellSkeleton:8`, `EnsureUser:52`. On a 390 px
  screen that spends 48 px on margins.
- `ChartSection:57` — title and the 24h/7d/30d range buttons in one unwrapped
  row.
- Admin fleet/user lists are `div`-based rows (there is no `<table>` anywhere),
  so they wrap rather than scroll, but wrap badly at phone width.

Tailwind v4 with a CSS `@theme` block; no `--breakpoint-*` overrides, so the
defaults apply (`sm` 640, `md` 768, `lg` 1024, `xl` 1280).

## 3. Why Playwright, and how it signs in

Neither existing test layer can catch a layout bug: jsdom has no layout engine,
so `getBoundingClientRect` is all zeros and media queries never match. Proving
"nothing overflows at 390 px" requires a real browser at a real viewport.

Authentication uses `@clerk/testing/playwright`, which needs **no password**:

- `clerkSetup()` obtains a Testing Token from the Clerk **development**
  instance at the start of the run.
- `clerk.signIn({ page, emailAddress })` mints a server-side token for that
  address and skips every verification step. An email address is the only
  credential involved.
- The resulting session is written to `playwright/.clerk/user.json`
  (gitignored) and reused by every spec through `storageState`.

`clerkSetup()` must run as a **project dependency**, not a function-based
`globalSetup` — the latter runs in a separate process and its `CLERK_FAPI` /
`CLERK_TESTING_TOKEN` never reach the workers.

## 4. Harness

| Piece      | Choice                                                          |
| ---------- | --------------------------------------------------------------- |
| Runner     | `@playwright/test`, chromium only                               |
| Location   | `apps/web/tests/e2e/*.spec.ts`                                  |
| Config     | `apps/web/playwright.config.ts`                                 |
| Projects   | `setup` → `phone` (390×844), `tablet` (768×1024)                |
| Web server | `yarn dev` on :3001, `reuseExistingServer: true`                |
| Scripts    | `test:e2e`, `test:e2e:secrets` (Infisical wrapper)              |

`.spec.ts`, not `.test.ts`: jest's `testMatch` is
`<rootDir>/tests/{unit,integration}/**/*.test.{ts,tsx}`, so the extension alone
keeps the two runners from colliding — no jest config change needed.

New environment variable: `E2E_CLERK_USER_EMAIL` (the address the suite signs
in as). Documented in `.env.example` without a value, supplied via Infisical.

Gitignored artifacts: `apps/web/playwright/.clerk/`, `apps/web/test-results/`,
`apps/web/playwright-report/`.

## 5. What a route assertion checks

For each route, at each viewport:

1. **No horizontal scroll** — `documentElement.scrollWidth` does not exceed the
   viewport width (1 px tolerance for sub-pixel rounding).
2. **Nothing clipped** — no element's bounding box crosses the right edge.
   Check 1 alone misses content hidden by an `overflow-hidden` ancestor, which
   is exactly how a squeezed flex row fails.
3. **Tap targets** — every visible `button`, `input`, `select`, and
   control-styled link is at least 44×44 CSS px. Links inside prose are
   excluded: they are text, and padding them to 44 px would wreck the
   paragraph. Deliberately a *separate* test per route, so a target-size
   failure reports distinctly from an overflow failure instead of hiding
   behind it.

Elements inside a container that legitimately scrolls sideways (a wide chart or
code block) are exempt via an opt-in `data-allow-x-scroll` attribute on that
container. No such container exists today; the escape hatch is defined so that
adding one later is a deliberate, greppable act rather than a silent loosening
of the assertion.

Routes covered: `/dashboard`, `/devices`, `/devices/[id]`, `/devices/register`,
`/alerts`, `/settings`, `/admin`, `/admin/users`, `/reference`, `/privacy`,
`/sign-in`.

## 6. Fixtures

`/devices/[id]` and `/admin` need real rows. Depending on whatever is in the
local database would make the suite fragile and order-dependent, so `setup`
provisions its own and tears it down afterwards, using the service-role client
exactly as `tests/integration` already does:

- one device, owned by the test user, with a handful of readings so the
  dashboard and chart render something rather than an empty state;
- the device id is handed to the specs through a fixture file written
  alongside the storage state.

`/admin` additionally requires the test user to be a member of `ADMIN_ORG_ID`
with that org active. That is an account property, not something the suite can
seed. If the configured user is not an admin, the admin specs **skip with an
explicit message** rather than fail — a missing admin fixture is a setup gap,
not a layout regression, and conflating the two would train us to ignore reds.

## 7. Responsive conventions

Applied consistently, so the result reads as one decision rather than twenty:

| Situation                   | Pattern                                        |
| --------------------------- | ---------------------------------------------- |
| Page gutter                 | `px-4 sm:px-6`                                 |
| Row that must stack         | `flex-col sm:flex-row items-start sm:items-center` |
| Dialog field pair           | `grid-cols-1 sm:grid-cols-2`                   |
| List row with controls      | controls drop to their own line below `sm`     |
| Admin list                  | card-per-row below `md`, row at/above          |

Breakpoints stay Tailwind's defaults; the `@theme` block is not touched.

## 8. Order of work

Shared primitives first — the gutter appears in five shell files, so fixing it
there corrects every route at once. Walking route by route instead would
re-solve the same gutter five times and drift.

1. Harness: dependencies, config, auth setup, fixtures, the assertion helper.
   Land it **red** — a failing suite that names the real defects is the
   specification for steps 2–5.
2. Shell primitives: the five gutters, `Dialog` field pairs.
3. Rows: `MembersList`, `ChartSection` header, `DeviceHeader`.
4. Admin lists: card-per-row below `md`.
5. Whatever the suite still reports — charts (Recharts responsive container)
   and the station map are the likely remainder.

## 9. Changes to CLAUDE.md

Two edits, both approved:

- The testing table gains a fourth row: **E2E · Playwright ·
  `apps/web/tests/e2e/` · layout at phone/tablet widths, real browser**.
- *"Script names: `test:unit`, `test:integration`, `test:db` — no other names"*
  becomes *"… `test:db`, `test:e2e` — no other names"*.

The environment-variable table gains `E2E_CLERK_USER_EMAIL`.

## 10. CI

Out of scope for this spec, deliberately. The `checks` job has neither Supabase
nor Clerk secrets, and the `database` job has only Supabase; running E2E there
means adding Clerk development keys as repository secrets and standing up
Supabase in a job that also builds the app. That is a separate decision with a
separate blast radius. This spec lands the suite as a **local** gate, run via
`yarn test:e2e:secrets`.

## 11. Risks

- **Testing Tokens are development-instance only.** The suite cannot run
  against a production Clerk instance. That is correct for its purpose but
  means it can never be a production smoke test.
- **A 44 px target minimum may fail existing controls** — `Button` `size="sm"`
  is `h-8` (32 px). Where a control genuinely cannot grow, the fix is padding
  on the hit area, not lowering the threshold. If that proves widespread, the
  target-size test is the piece to land last so it never blocks the overflow
  fixes.
- **Flake risk from animation.** Motion entry animations mean a screenshot or
  measurement taken too early sees an element mid-transform. Measurements wait
  for the animation to settle rather than using a fixed sleep.
