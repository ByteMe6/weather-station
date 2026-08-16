# MRP-32 — Web onboarding verification (Flow 1)

Environment: local stack (Next dev on :3001 via Infisical, local Supabase with
`[auth.third_party.clerk]`, Clerk dev instance `trusted-longhorn-13` with the
`role: authenticated` session claim). Readings were posted with the HMAC-signed
ingest helper against a locally provisioned device `ws-0bd18d46d87b`; the
walk was done in the project owner's Chrome via the Claude Chrome extension.

| Check (ticket AC) | Result | Notes |
| --- | --- | --- |
| Signed-out visit to `/dashboard` redirects to sign-in and returns after auth | ✅ | proxy `auth.protect()` → Clerk handshake → `/sign-in?redirect_url=…`; `(app)` layout also calls `auth.protect()` |
| Sign-up form renders (email/password + Google) with privacy links | ✅ | Clerk `<SignUp/>` in `AuthFrame`; verify-email step reached with a `+clerk_test` address |
| Fresh account: dashboard shows "No station yet" prompt (W7) | ✅ | empty state with "Register a device" → `/devices/register` |
| Register device-id → toast → redirect → "Waiting for the first reading" | ✅ | id typed as `WS-0BD18D46D87B`, normalised to lowercase; nav chip shows the station |
| Unknown / already-claimed id → inline error, no change | ✅ (tests) | `registerDeviceAction` unit tests + `claim_device` pgTAP (16 cases) + devices integration test |
| First reading visible ≤ 15 s after POST (target < 1 s via Realtime) | ✅ | appeared within ~1 s, no refresh; hero numeral, cards, chart updated |
| Live update after Clerk token expiry (soak > 60 s) | ✅ | reading posted after 80 s arrived live; fixed a supabase-js "manual token" pitfall (`readings.realtime.ts`) |
| Reconnect after dropped socket refetches | ✅ (unit) | `useReadingsRealtime` resubscribes with backoff on `CLOSED`, invalidates on re-`SUBSCRIBED`; laptop-sleep run pending |
| 24 h chart shows history correctly; gaps render as gaps | ✅ (3 h backfill) | 36 backfilled + live points draw the line, min/max, 3 h trends; gap insertion unit-tested; a real day of data pending |
| Mobile viewport (≈390 px): strip, cards, charts, menu sheet | ✅ | 2-column cards, legible ticks; Y-axis widened for `1015.2` |
| Light + dark theme | ✅ | fixed: `light-dark()` was polyfilled by Lightning CSS → class-based tokens |
| Second account cannot register the same device or see its data | ✅ (tests) | devices integration test (claim → `DEVICE_ALREADY_CLAIMED`, `fetchMyDevices` = `[]`), readings integration test (range/latest empty), pgTAP `realtime_publication.sql` (walrus replay: non-member receives nothing); UI walk with a second account pending |
| Total onboarding time from first visit to live data < 10 min | ⏳ | register → live reading took ≈ 1 min in this walk; full timing needs a fresh account + real device |
| Findings filed as tickets | see below | |

## Findings during the walk (all fixed in this branch)

1. `'use server'` module exported a sync helper (`normalizeDeviceId`) → registration page failed to compile in the browser. Moved to `lib/device-id.ts`.
2. Device ids: provisioning mints lowercase `ws-<12 hex>`; the action uppercased input → every real registration would fail (`DEVICE_NOT_FOUND`). Normalised to lowercase (found by the RLS reviewer).
3. Realtime channel closed after 60 s: supabase-js pins the constructor's first token as "manual" and stops refreshing it. Hook now refreshes auth itself and resubscribes on `CLOSED`.
4. Theme toggle could not override the OS: Lightning CSS polyfills `light-dark()` with `prefers-color-scheme`. Tokens moved to `.dark` overrides.
5. `claim_device` treated any other member as an owner (would reject the real owner once shared) — now checks `role = 'owner'` and promotes the sole remaining member.
6. Chart polish: last x-tick and 6-char y-labels clipped → margins/axis width.

## Still to verify with hardware / a fresh account

- Full Flow 1 timing (< 10 min) with a fresh Clerk account and a real ESP32.
- 24 h chart after a day of real readings.
- Second-account isolation walked through the UI (covered by tests today).
- Laptop-sleep reconnect on a real network.
