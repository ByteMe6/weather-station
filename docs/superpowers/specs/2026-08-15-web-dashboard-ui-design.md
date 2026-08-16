# Web dashboard UI — design system, screens, and data paths

Covers every `Web`-labelled Linear ticket in the Mrplit team, across phases:

| Phase | Ticket | Scope in this spec |
| --- | --- | --- |
| 2 (MVP) | MRP-17 | Clerk auth: sign-in/up pages, route protection, sign-out |
| 2 (MVP) | MRP-19 | Clerk ↔ Supabase: `users` row on first sign-in, RLS-compatible JWT, browser client |
| 2 (MVP) | MRP-22 | Device registration page + `claim_device` server action |
| 2 (MVP) | MRP-25 | Dashboard: live latest readings via Realtime, empty/waiting states |
| 2 (MVP) | MRP-27 | 24-hour chart per parameter (Recharts) |
| 2 (MVP) | MRP-32 | Web onboarding E2E verification (Flow 1) |
| 4 | MRP-33 | Wind & precipitation cards + charts (web part only) |
| 5 | MRP-34 | 7-day / 30-day range selector with bucketed data |
| 5 | MRP-35 | CSV export (chunked server action) |
| 6 | MRP-37 | Telegram linking page (one-time code via bot deep link) |
| 6 | MRP-38 | Device sharing with roles (owner / editor / viewer) |
| 6 | MRP-40 | Account deletion (right to erasure) |
| 6 | MRP-41 | Privacy policy page |
| 6 | MRP-42 | Alert management UI (`schedules`) |

Implementation is split into two plans (see [Plans](#plans)): Plan 1 =
foundation + Phase 2, Plan 2 = Phases 4–6 web work.

Visual direction: **01 · Instrument**, chosen from five mockups in
`docs/superpowers/mockups/2026-08-15-ui-direction/` (`01-instrument.html` is
the reference; the mockups are not shipped code).

---

## Problem

`apps/web` today is API-only: the HMAC ingest route, health, OpenAPI docs, and
a placeholder home page. There is no auth, no data layer in the browser, no
component library, and no motion layer. The 14 web tickets each describe a
screen or flow; without a shared design system they would each re-invent
cards, dialogs, empty states, and animation timing, and the product would not
read as one thing.

This spec fixes the shared foundation once — tokens, type, motion vocabulary,
shell, data-path wiring — and then describes every screen on top of it, in
enough detail that each ticket becomes a mechanical plan.

## Goals

- One visual system across all screens: neutral chrome, parameter colours
  that carry meaning, instrument-style numerals, light + dark.
- Every data page has a skeleton, an empty state, and an error state.
- Motion is deliberate: one orchestrated "reading arrives" moment, quiet
  everywhere else, reduced-motion respected.
- Data paths follow CLAUDE.md exactly: client path (Clerk JWT + RLS) for all
  reads and user-scoped writes; server actions only for registration,
  sharing, Telegram link/unlink, account deletion, CSV export.
- Each ticket's acceptance criteria are traceable to a section below.

## Non-goals

- Bot-side work (grammY handlers) beyond defining the Telegram-link contract.
- Firmware changes; `readings_daily` retention (MRP-36); dual-auth identity
  design (MRP-39).
- A `packages/ui` workspace or Storybook — this is a single app; components
  live in `apps/web/src/components`.
- Marketing/landing page. `/` redirects to the dashboard.

---

## 1. Design system

### 1.1 Tokens

Defined once in `apps/web/src/app/globals.css` with Tailwind v4 `@theme`
(light values) plus a `.dark { … }` override block; `next-themes` sets the
`dark` class on `<html>` (system preference by default, user override from the
nav). _Amended during Plan 1:_ not `light-dark()` — Lightning CSS polyfills it
with `prefers-color-scheme`, so an explicit user toggle could never win.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#F7F9FC` | `#0B1220` | page background |
| `--card` | `#FFFFFF` | `#111A2C` | card / panel surface |
| `--ink` | `#0B1526` | `#E8EEF7` | primary text |
| `--slate` | `#5B6B82` | `#8B9AB3` | secondary text, labels |
| `--line` | `#DCE3EC` | `#1E2A3E` | borders, gridlines |
| `--sky` | `#1E6FE8` | `#4D8DFF` | primary action, focus ring, live dot |
| `--danger` | `#D3323A` | `#FF6B6B` | destructive, errors |
| `--temp` | `#E4572E` | same | temperature |
| `--hum` | `#1B9AAA` | same | humidity |
| `--press` | `#7C5CE0` | same | pressure |
| `--wind` | `#D9A21B` | same | wind speed / direction |
| `--rain` | `#2F5FE0` | same | precipitation |

Parameter hues are colour-blind-safe as a set (no red/green pair). Chrome
never uses a parameter hue for decoration, so a colour on screen always means
"this parameter".

Radii: card `14px`, control `9px`, pill `999px`. Shadows: cards get
`0 1px 2px rgb(11 21 38 / 4%)` only; elevation is expressed with borders, not
shadow stacks. Focus: `2px` `--sky` ring, offset `2px`, always visible on
keyboard focus.

### 1.2 Type

- **Archivo** (variable, `next/font/google`, axes `wdth` + `wght`) for
  everything textual. Headings and body at `wdth 100`; **readout numerals at
  `wdth 75–88`, weight 600, `font-variant-numeric: tabular-nums`,
  letter-spacing `-0.03em`** — this narrow tabular treatment is what makes the
  numbers read as an instrument.
- **DM Mono** for timestamps, device IDs, units in dense contexts, axis labels.
- Scale (px): 12 label · 13 meta · 14 body · 15 section title · 26 inline
  readout · 32 card readout · 112 hero readout (88 below 900px).

### 1.3 Motion vocabulary

All motion uses `motion` (`motion/react`) or CSS. Rules:

- **Springs, no overshoot.** Default transition
  `{ type: 'spring', bounce: 0, visualDuration: 0.35 }`; snappy variant
  `visualDuration: 0.2` for controls. This is a data tool: nothing bounces.
- **Page load:** sections stagger in (`fadeUp`: `y: 12 → 0`, `opacity 0 → 1`,
  stagger `0.06s`). Only on mount, never on data refetch.
- **The reading arrives** (signature, dashboard only): when a Realtime insert
  changes the latest reading — (1) numerals roll to the new value with
  `NumberRoll` (`useSpring` on a motion value, formatted via `useTransform`);
  (2) the freshness dot does one expanded pulse; (3) the chart's newest point
  draws in (`<motion.circle>` scale `0 → 1`) and the line extends. Total
  ≈ 600 ms, no layout shift.
- **Layout animation:** nav active indicator and range segmented control use
  `layoutId`; card grid uses `layout` when cards appear/disappear (Phase 4
  sensors).
- **Presence:** dialogs, sheets, toasts, and empty ↔ data state swaps use
  `AnimatePresence` (fade + `y: 8`). Route changes: fade-in only via
  `app/(app)/template.tsx` — no exit animations across routes.
- **Reduced motion:** `<MotionConfig reducedMotion="user">` at the root plus
  `@media (prefers-reduced-motion: reduce)` for CSS pulses. `NumberRoll`
  snaps, pulses stop, staggers collapse to a single fade.
- **Charts:** Recharts `isAnimationActive={false}` (re-renders must not
  animate); only the newest point animates as above.

Helpers live in `components/motion/`: `variants.ts` (`fadeUp`, `stagger`,
`springs`), `MotionProvider.tsx`, `NumberRoll.tsx`, `FreshnessPulse.tsx`,
`Reveal.tsx` (whileInView for below-fold sections).

### 1.4 Primitives (`components/ui/`)

Hand-styled on Radix headless primitives (`radix-ui` unified package):
`Button` (primary / ghost / danger, sizes sm/md), `Card`, `Dialog`, `Sheet`
(mobile nav, export), `Tabs`, `SegmentedControl` (custom, `layoutId`
indicator), `Input`, `Select`, `Switch`, `Toast` (Radix Toast + presence),
`Skeleton`, `Badge`, `EmptyState`, `Field` (label + control + error, wraps
`react-hook-form`). Every component: arrow function, named `ReactElement`
return, `testId` prop → `data-testid`, `className` passthrough via `cn()`
(`clsx` + `tailwind-merge`). No shadcn (its generated `function` declarations
and lack of `testId` conflict with the lint rules).

Icons: `lucide-react`.

---

## 2. Information architecture & shell

### 2.1 Routes

```
app/
  layout.tsx                 ClerkProvider › ThemeProvider › QueryProvider › MotionProvider
  page.tsx                   redirect('/dashboard')  (auth() → sign-in if signed out)
  sign-in/[[...sign-in]]/page.tsx   <SignIn/> themed (appearance) + privacy link
  sign-up/[[...sign-up]]/page.tsx   <SignUp/> themed + privacy link
  privacy/page.tsx           public, static
  (app)/
    layout.tsx               <AppShell> (nav) + <EnsureUser> gate + skeleton
    template.tsx             fade-in on route change
    dashboard/page.tsx       conditions strip · cards · charts · export button
    devices/register/page.tsx
    devices/[deviceId]/page.tsx     device settings: members & sharing (Phase 6)
    alerts/page.tsx          schedules CRUD (Phase 6)
    settings/page.tsx        Telegram link, theme, delete account (Phase 6)
  api/…                      unchanged (ingest, health, openapi) + webhooks/clerk (Phase 6)
proxy.ts                     clerkMiddleware; public: /, /sign-in, /sign-up, /privacy,
                             /api/v*/…, /api/webhooks/…, /reference, /api-docs
```

Nav order: **Dashboard · Alerts · Devices · Settings**. The nav renders only
the routes that exist: in Plan 1 that is Dashboard · Settings (theme only);
`/devices/register` is reached from the dashboard empty state and the device
chip menu, not from the nav. Alerts and Devices join the nav in Plan 2.

### 2.2 App shell

Top bar, 60px, sticky, `paper` at 88% with backdrop blur, 1px `line` bottom.
Left: brand mark + "Weather Station". Centre-left: nav links, active has a
2px `sky` underline that slides between items (`layoutId="nav-indicator"`).
Right: current device chip (`DM Mono`, "Backyard · WS-7F3A" — device label is
the device id until naming exists), theme toggle, Clerk `<UserButton/>`.
Below 768px: links collapse into a `Sheet` opened by a menu button; the device
chip moves into the sheet header.

Content container `max-width 1180px`, padding `28px 24px 60px`.

### 2.3 Global states

- **Auth gate:** `proxy.ts` redirects signed-out users to `/sign-in` with
  `redirect_url` back to the requested page (Clerk default). MRP-17.
- **User gate:** `(app)/layout.tsx` renders `<EnsureUser>` which calls
  `ensureCurrentUserAction()` once per session (TanStack mutation, keyed on
  Clerk `userId`) and shows the shell skeleton until it resolves. Children
  render only after the `users` row is guaranteed. MRP-19.
- **Skeletons:** every page renders its skeleton while `!isUserLoaded ||
  isLoading` (CLAUDE.md rule); skeleton shapes match the final layout to avoid
  shift.
- **Errors:** query errors render an inline `EmptyState` variant with retry;
  mutation errors surface as toasts (`danger`), field-level where the action
  returns a `fieldErrors` map.

---

## 3. Data layer

### 3.1 Browser client & auth (MRP-19)

`lib/supabase.ts` exports `useSupabaseClient()` exactly as in CLAUDE.md
(publishable key + Clerk `accessToken`). Supabase is configured for
**third-party auth with Clerk** (`[auth.third_party.clerk]` in `config.toml`
locally; dashboard in prod) so `auth.jwt() ->> 'sub'` is the Clerk user id and
`current_app_user_id()` resolves. The Clerk session token must carry the claim
`"role": "authenticated"` (Clerk dashboard → Sessions → Customize session
token) — without it Supabase treats the JWT as `anon` and every RLS query
returns empty. This is documented in `apps/web/.env.example` and the plan.

`users` row creation: **lazy, via server action** `ensureCurrentUserAction()`
(service role, `upsert` on `clerk_user_id`, `ignoreDuplicates`). Decision
recorded here per the ticket AC: lazy creation needs no webhook config in
previews and can't race the first RLS query because the `(app)` layout gates
on it. The Clerk `user.deleted` webhook (Phase 6, MRP-40) is the only webhook.

### 3.2 Services & hooks

`services/{domain}/{domain}.service.ts` (pure, `SupabaseClient<Database>`
first param, `ServiceError`, aliased selects) and
`services/{domain}/{domain}.queries.ts` (query-key factories + hooks).

| Domain | Service functions | Hooks |
| --- | --- | --- |
| `users` | `fetchCurrentUser` (own row via RLS: `id, clerkUserId, telegramId`) | `useCurrentUserQuery` |
| `devices` | `fetchMyDevices` (`devices` ∪ `device_users.role`), `fetchDeviceMembers` (Phase 6) | `useMyDevicesQuery`, `useDeviceMembersQuery` |
| `readings` | `fetchLatestReading`, `fetchReadingsRange({deviceId, from, to})`, `fetchReadingsBucketed({deviceId, from, to, bucketMinutes})` (Phase 5 RPC) | `useLatestReadingQuery`, `useReadingsHistoryQuery(deviceId, range)`, `useReadingsRealtime(deviceId)` |
| `schedules` | `fetchSchedules`, `createSchedule`, `updateSchedule`, `deleteSchedule` (Phase 6, client path — RLS already allows) | `useSchedulesQuery`, `useCreateScheduleMutation`, … |

Key factories: `userKeys.current`, `deviceKeys.mine`,
`deviceKeys.members(deviceId)`, `readingKeys.latest(deviceId)`,
`readingKeys.history(deviceId, range)`, `scheduleKeys.all`.

`fetchReadingsRange` selects the aliased columns from CLAUDE.md, filters
`device_id` + `timestamp gte/lte`, orders ascending, and hard-limits to
`2000` rows (24h = 288). Ranges > 24h always go through the bucketed RPC.

### 3.3 Realtime (MRP-25)

- Migration `enable_readings_realtime`: `alter publication supabase_realtime
  add table public.readings;` — postgres_changes honours the existing RLS
  select policy, so a user only receives rows for their devices.
- `useReadingsRealtime(deviceId)`: subscribes to
  `postgres_changes` `INSERT` on `readings` with `filter: device_id=eq.<id>`;
  on payload → `queryClient.setQueryData(readingKeys.latest(id), row)` and
  appends to any cached `history(id, '24h')` array (dedup by `id`). Calls
  `client.realtime.setAuth(token)` before subscribing; supabase-js re-runs the
  `accessToken` callback on heartbeat so Clerk's 60s tokens keep the socket
  authorised (verified in the plan with a >2-minute soak).
- Reconnect: on channel status `SUBSCRIBED` after a prior `CLOSED`/`CHANNEL_ERROR`
  (laptop sleep), invalidate `latest` and `history` for the device to fill any
  gap. Status is exposed as `'live' | 'reconnecting' | 'offline'` and shown in
  the freshness eyebrow.
- Freshness: eyebrow shows "Updated 12:35 · 2 min ago" (`Intl.RelativeTimeFormat`,
  ticks every 30s) and the live dot; if the last reading is older than
  `3 × DEFAULT_SEND_INTERVAL_MS`, the dot turns `slate` and the label reads
  "No reading for 17 min" — that's the "device offline" signal without a new
  table.

### 3.4 Server actions (`actions/*.action.ts`)

All start with `'use server'`, `import 'server-only'`, `auth()`, input
validation with zod, `createServiceRoleClient()`, explicit ownership checks,
and return a discriminated union `{ ok: true, data } | { ok: false, code,
message, fieldErrors? }` — never throw across the boundary (throwing loses
the error code on the client).

| Action | Ticket | Behaviour |
| --- | --- | --- |
| `ensureCurrentUserAction` | 19 | upsert `users` by `clerk_user_id`; returns internal `userId` |
| `registerDeviceAction({deviceId})` | 22 | trims/uppercases id; RPC `claim_device(p_device_id, p_user_id)`; maps SQL errors `DEVICE_NOT_FOUND`, `DEVICE_ALREADY_CLAIMED` to codes; idempotent for same user |
| `exportReadingsChunkAction({deviceId, from, to, cursor})` | 35 | ownership via `device_users`; returns up to 1 000 rows (PostgREST `max_rows`) as CSV lines + `nextCursor` (keyset on `timestamp,id`); first call includes header |
| `shareDeviceAction`, `updateMemberRoleAction`, `removeMemberAction` | 38 | requester must be `owner`; target resolved from `users` by `clerk_user_id` **or** `telegram_id`; last owner cannot be removed/demoted |
| `startTelegramLinkAction`, `unlinkTelegramAction` | 37 | see §4.7 |
| `deleteAccountAction` | 40 | see §4.9 |

### 3.5 Migrations (all with pgTAP)

1. `enable_readings_realtime` — publication (§3.3).
2. `claim_device_fn` — `claim_device(p_device_id text, p_user_id uuid)`
   `security definer`, `set search_path = ''`, `select … for update` on
   `devices`; raises `DEVICE_NOT_FOUND` / `DEVICE_ALREADY_CLAIMED` via
   `raise exception using errcode = 'P0001', message = '<code>'`; inserts
   `device_users(owner)` `on conflict do nothing`; sets `status='registered'`.
   `revoke execute from public, anon, authenticated; grant to service_role`.
3. `readings_bucketed_fn` (Phase 5) — `readings_bucketed(p_device_id,
   p_from, p_to, p_bucket_minutes)` **`security invoker`**, `stable`, returns
   `(bucket timestamptz, avg_temperature, min_temperature, max_temperature,
   avg_humidity, …, total_precipitation)` via `date_bin`; grant to
   `authenticated` — RLS on `readings` still applies because it's invoker.
4. `device_sharing_policies` (Phase 6) — `is_device_owner(p_device_id)`
   `security definer stable` helper; policy "owners can view all links for
   their devices" on `device_users` using `(select public.is_device_owner(device_id))`
   (helper avoids recursive policy evaluation).
5. `telegram_link_codes` (Phase 6) — table `(code text pk, user_id uuid fk,
   expires_at timestamptz, consumed_at timestamptz)`, RLS enabled, **no
   client policies** (server/bot only), index on `user_id`.

Every migration: `yarn regenerate:types`; every RLS change: pgTAP proving A
cannot see B (device_users owner view, link codes invisible to clients,
bucketed RPC returns 0 rows for a non-member).

---

## 4. Screens

### 4.1 Sign-in / sign-up (MRP-17)

Clerk `<SignIn/>`/`<SignUp/>` on a `paper` page, centred, with Clerk
`appearance` variables mapped to the tokens (primary = `sky`, radius 9px,
font Archivo). Below the card: "By continuing you agree to the privacy
policy" → `/privacy` (MRP-41 links from sign-up). Email/password + Google
enabled in the Clerk dashboard (documented, not code). Sign-out via
`<UserButton/>`. After auth, Clerk returns to `redirect_url`.

### 4.2 Dashboard (MRP-25, 27, 33, 34)

Layout (matches mockup 01):

```
[eyebrow: ● Updated 12:35 · 2 min ago]            [Export CSV]
[ 21.4 °C ]  Humidity  Pressure  Wind  Rain today  24 h range
─────────────────────────────────────────────────────────────
[Temp card][Hum card][Press card][Wind card][Rain card]
[ Chart panel: Temperature   ● °C  min · max   [24 h|7 d|30 d] ]
[ Chart panel: Humidity … ] [ Pressure … ] (one panel per parameter, stacked)
```

- **Conditions strip:** hero numeral = temperature (`NumberRoll`), inline
  secondary readouts with 3-hour trend glyphs (▴ ▾ —, computed client-side
  from the 24h history: value now vs value ≈3h ago; falls back to "—" if
  fewer than 2 points).
- **Cards:** one per parameter; label, readout, 3h sparkline (Recharts
  `LineChart` 60×24, no axes), trend. Card left edge carries the parameter
  hue (3px). Humidity/wind/rain cards render a **"sensor not fitted"** state
  (`opacity .55`, dashed sparkline, no value) when the latest reading has
  `null` for that field — this is how BMP280-only devices and the mixed fleet
  (MRP-33) look right from day one. Wind direction shows a compass glyph
  rotated to the bearing plus the 16-point label.
- **Charts (MRP-27):** one `Card` per parameter (temperature, humidity,
  pressure; wind & precipitation added by MRP-33 when the device reports
  them). Recharts `LineChart` + `XAxis type="number" scale="time"` with
  `Intl.DateTimeFormat` ticks in the viewer's timezone, `YAxis` with unit,
  `Tooltip` (custom, shows value + local time), gaps > 2 × interval rendered
  as gaps (`withGaps()` inserts `null`, `connectNulls={false}`), newest point
  animated. Mobile: panels stack, x-ticks reduce to 3.
- **Range selector (MRP-34):** `SegmentedControl` 24 h / 7 d / 30 d, shared
  across all chart panels, persisted in the URL search param `?range=` (so it
  survives navigation and refresh). 24 h → raw rows; 7 d → 60-minute buckets
  (168 points); 30 d → 6-hour buckets (120 points). Bucketed views draw the
  average line plus a min–max band (`Area` with parameter hue at 12%).
  Partial ranges (device younger than the window) simply start where data
  starts. Loading a new range shows the panel skeleton, never a blank chart.
- **Empty states (W7):** no device → full-width `EmptyState` "No station yet"
  with a one-sentence explanation and a primary "Register a device" button;
  device but no readings → "Waiting for the first reading" with the live dot
  and the ingest interval hint ("your station posts every 5 minutes"). Both
  animate in via `AnimatePresence` when swapping to data.
- **Multiple devices:** the PRD is single-device per user, but `device_users`
  allows several (sharing). The dashboard shows the first device by
  `added_at`; if more than one, the device chip becomes a `Select`. Selection
  persists in `?device=`.

### 4.3 Device registration (MRP-22)

`/devices/register`: a single centred `Card` — heading "Register your
station", copy "Enter the ID printed on the label under the device.", one
`Input` (mono, auto-uppercase, `WS-XXXX` placeholder), primary button
"Register device". Server action errors render inline under the field:
"We don't recognise that ID — check the label" (`DEVICE_NOT_FOUND`) or "This
station is already linked to another account" (`DEVICE_ALREADY_CLAIMED`).
Success → toast "Station registered" → `router.replace('/dashboard')`,
where the "waiting for first reading" state appears. Same user registering
again is idempotent (returns ok, no toast variance).

### 4.4 CSV export (MRP-35)

"Export CSV" button on the dashboard opens a `Dialog`: two native date inputs
(from/to, default last 7 days, max span 366 days), a summary line ("≈ 2 016
readings"), and "Download". On submit the client loops
`exportReadingsChunkAction` with the cursor, appending chunks to an array,
showing a determinate progress bar (`motion.div` width spring) with "42 000
of ≈ 105 000 rows"; on completion it builds a `Blob`, triggers download named
`weather_<deviceId>_<from>_<to>.csv`, closes the dialog with a toast. Empty
range → header-only CSV, still a valid download. CSV columns:
`timestamp_utc,device_id,temperature_c,humidity_pct,pressure_hpa,wind_speed_kmh,wind_direction_deg,precipitation_mm`.

Chunked-server-action is the documented approach for the "no Vercel limits"
AC: no single response exceeds ~1 MB, and the browser assembles the file.

### 4.5 Devices page & sharing (MRP-38)

`/devices/[deviceId]`: header with the device id and status badge; section
"People with access" — list of members (identifier masked: Clerk id shown as
`user_…3f2a`, Telegram id as `tg · …4821`), role `Select` (owner only),
remove button; "Share access" `Dialog` with identifier input (Clerk user ID
or Telegram ID — auto-detected: numeric → Telegram), role `Select`
(owner/editor/viewer, default viewer), submit. Errors: "No account with that
ID has signed in yet" (`USER_NOT_FOUND`), "Already has access". Viewers see
the list read-only with an explanation line. Role semantics: **owner** —
share/change roles/remove/unregister; **editor** — reserved (same as viewer
for now, kept because the schema and PRD define it); **viewer** — read-only.
DB layer: no authenticated write policies exist on `device_users`, so viewers
cannot escalate even bypassing the UI; pgTAP proves it.

### 4.6 Alerts (MRP-42)

`/alerts`: if `telegramId` is null → `EmptyState` "Link Telegram to manage
alerts here" with a button to `/settings`. Otherwise a list of schedule rows
(time in the user's zone, day pills Mon–Sun, timezone label) with edit/delete,
and an "Add alert" `Dialog`: time input, 7 day toggles (Mon–Fri preselected),
timezone (defaults to `Intl…resolvedOptions().timeZone`, editable `Select`).
All CRUD via the client path (`schedules` RLS). Optimistic add/remove with
`AnimatePresence` on rows. Copy explains that alerts arrive in Telegram at
that local time; validation matches the bot (HH:MM, ≥1 day).

### 4.7 Settings — Telegram linking (MRP-37)

`/settings` sections: **Appearance** (theme: system / light / dark),
**Telegram**, **Danger zone** (Phase 6).

Telegram card states: *Not linked* → button "Link Telegram" →
`startTelegramLinkAction` creates a code (`crypto.randomUUID()` base32-ish,
10 min TTL) and returns a deep link `https://t.me/<BOT_USERNAME>?start=link_<code>`;
the UI shows the link as a button + QR (`qrcode` package, rendered
client-side) and polls `getTelegramLinkStatusAction({ code })` every 3 s while
pending (states: `pending | linked | expired | failed`), refetching
`useCurrentUserQuery` once linked. When the
bot consumes the code it sets `users.telegram_id` and marks the code
consumed; the page flips to *Linked* ("Linked as tg · …4821", "Unlink"). Unlink
→ `unlinkTelegramAction` nulls `telegram_id`. Conflicts (Telegram already
linked to another account) are enforced by the `users.telegram_id` unique
index and surfaced by the bot; the web shows "That Telegram account is linked
to another user" if the code is marked failed.

**Contract for the bot (MRP-21 owns it):** on `/start link_<code>` →
service-role: find unconsumed, unexpired code → set `users.telegram_id` for
`code.user_id` (fail if another user already has that id) → mark consumed →
reply. Web ships the table, actions, and UI; the bot handler is a
clearly-marked cross-cutting task in Plan 2 (its scaffold exists).

`NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is a new env var.

### 4.8 Privacy policy (MRP-41)

`/privacy`: static page in the same shell-less layout as sign-in (brand +
back link), Archivo prose, sections: what we collect (readings, Clerk id,
Telegram id), purpose, retention (12-month raw + permanent daily aggregates —
worded to match MRP-36's decision), sharing (none public), your rights &
erasure (links to `/settings`), contact. Linked from the sign-in/up footer and
the app footer. Content reviewed by the project owner before launch (AC).

### 4.9 Settings — delete account (MRP-40)

"Delete account" (danger) → `Dialog` requiring the user to type `delete`;
`deleteAccountAction`: (1) service role deletes the `users` row (cascades
`device_users`, `schedules`, `telegram_link_codes`; the existing
`maintain_device_status` trigger flips owned devices back to `unregistered`);
(2) **readings are kept** — they are device-scoped, not personal, and the
device is re-claimable (decision per AC); (3) `clerkClient().users.deleteUser`;
(4) client calls `signOut()` and lands on `/sign-in` with a toast. Clerk
webhook `POST /api/webhooks/clerk` (svix-verified, `user.deleted`) performs
step 1 for deletions initiated in Clerk. Telegram-only users: documented
support path (bot command is MRP-24/26 territory).

---

## 5. Component map

```
components/
  ui/            Button Card Dialog Sheet Tabs SegmentedControl Input Select Switch
                 Toast Skeleton Badge EmptyState Field
  motion/        variants.ts MotionProvider NumberRoll FreshnessPulse Reveal
  shell/         AppShell TopNav MobileNav DeviceChip ThemeToggle Footer
  dashboard/     ConditionsStrip ParameterCard ParameterCardGrid TrendGlyph
                 CompassGlyph WaitingForReading NoDeviceState DashboardSkeleton
  charts/        ParameterChart ChartTooltip RangeSelector Sparkline useChartData
  devices/       RegisterDeviceForm DeviceHeader MembersList ShareDialog
  export/        ExportDialog useCsvExport
  alerts/        ScheduleList ScheduleRow ScheduleDialog DayPicker
  settings/      AppearanceCard TelegramCard DeleteAccountCard
lib/
  supabase.ts query-client.tsx format.ts (units, relative time, bearings)
  chart.ts (withGaps, trend, bucket → series) csv.ts (row → line) theme.ts
services/ users devices readings schedules   actions/ users devices readings telegram account
```

Files stay small: a component file over ~200 lines is a signal to split.

---

## 6. Testing

| Layer | What |
| --- | --- |
| Unit (Jest + jsdom + RTL) | `format.ts`, `chart.ts` (gaps, trend, buckets), `csv.ts`; hooks with mocked client (`useReadingsRealtime` upserts cache, reconnect invalidates); components: skeleton/empty/data states render with `testId`s; `NumberRoll` snaps under reduced motion; server actions with mocked Clerk + service client (ownership denials, error codes) |
| Integration (local Supabase) | every service file: RLS enforced (user A vs B), `claim_device` RPC paths, `readings_bucketed` counts, schedules CRUD as authenticated |
| pgTAP | publication contains `readings`; `claim_device` grants/errors; owner-view policy on `device_users`; viewer cannot write `device_users`; `telegram_link_codes` invisible to authenticated; bucketed RPC returns 0 rows for non-member |
| E2E (MRP-32) | scripted checklist run against a preview with a real device: sign-up → empty state → register → waiting → live reading < 15 s → chart after 24 h; second account cannot claim/see; findings doc + follow-up tickets |

Jest for `apps/web` gains a `jsdom` environment for `tests/unit/components/**`
and `tests/unit/hooks/**` (separate project entry so service tests stay on
node).

## 7. Environment & config

New/used variables (documented in `apps/web/.env.example`, injected via
Infisical): `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`
(Phase 6), `CLERK_WEBHOOK_SIGNING_SECRET` (Phase 6).

Supabase: `[auth.third_party.clerk]` enabled with the Clerk domain (local
`config.toml` + prod dashboard). Clerk: session token claim `role:
authenticated`; Google OAuth on; sign-in/up paths set.

## 8. Risks

- **Clerk token TTL vs Realtime socket** — mitigated by supabase-js's
  `accessToken` re-fetch on heartbeat; verified with a soak test in Plan 1.
- **Realtime + RLS filter** — postgres_changes with RLS evaluates the policy
  per row for each subscriber; fine at MVP scale (one device per user).
- **Recharts + React 19 / Next 16 SSR** — charts render client-only
  (`'use client'`, `ResponsiveContainer` with `initialDimension`); a snapshot
  test guards the SSR path.
- **Theme switching** — class-based tokens (`.dark` overrides), no
  `light-dark()` (see §1.1 amendment).
- **Chunked export on slow links** — 1 000-row chunks (PostgREST `max_rows`) × ~105 calls for a year;
  progress UI makes it tolerable; abortable via dialog close.
- **Server-action error shape** — actions return unions, never throw; a
  shared `ActionResult<T>` type and `actionError()` helper keep this uniform.

## Plans

- `docs/superpowers/plans/2026-08-15-web-plan-1-foundation-mvp.md` —
  foundation (deps, tokens, primitives, motion, shell, data layer, Clerk,
  migrations 1–2) + MRP-17, 19, 22, 25, 27, 32.
- `docs/superpowers/plans/2026-08-15-web-plan-2-history-sharing-settings.md` —
  MRP-33, 34, 35, 37, 38, 40, 41, 42 + migrations 3–5 + bot link handler.
