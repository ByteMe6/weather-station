# Admin console — verification

**Date:** 2026-08-16
**Branch:** `feature/web-admin-console`
**Plan:** `docs/superpowers/plans/2026-08-16-admin-console.md`
**How:** real Chrome profile (Claude extension) against the local stack on
`:3001`, with the existing Clerk organization **MRPL IT** as the admin org
(`ADMIN_ORG_ID` inline on the dev server, the same id in the Vault secret).

## Gate

| Check                                | Result                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `yarn lint`                          | ✅ 3/3 workspaces                                      |
| `yarn check-types`                   | ✅ 3/3 workspaces                                      |
| `yarn test:unit`                     | ✅ 9 shared + 254 web                                  |
| `test:integration:secrets`           | ✅ 14                                                  |
| `db-reset:local` + `test:db` (pgTAP) | ✅ PASS from a clean database, 12 suites / 135 asserts |
| `infisical run -- yarn build`        | ✅ `/admin`, `/admin/activate`, `/admin/users`          |

## Browser checks

| #  | Check                                                     | Result                                                                  |
| -- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1  | `/admin` with the org inactive → activation, then console  | ✅ proxy → `/admin/activate` → `setActive` → console                     |
| 2  | Console lists the fleet through the admin RLS policy       | ✅ devices listed; the same query as a normal user returns only their own |
| 3  | **Create device** shows id + secret exactly once            | ✅ `ws-5dcdae508050`, 64-hex secret, "shown once" warning                 |
| 4  | **The created device can ingest**                           | ✅ signed POST `/api/v1/readings` → **201**                              |
| 5  | **Rotate secret** invalidates the old one                   | ✅ old secret → **401**, new secret → **201**                            |
| 6  | **Unclaim** frees the device, keeps readings                | ✅ `registered/1 member` → `unregistered/0 members`, 2 readings kept      |
| 7  | **Delete** requires the id typed, then cascades             | ✅ wrong id → "Type the device id to confirm"; correct → device + readings gone |
| 8  | `/admin/users` lists users with masked tails                | ✅ `user_…Glg9 · 0 stations`                                             |
| 9  | Config-mismatch banner when env ≠ Vault                     | ✅ banner appeared after repointing the Vault secret, cleared on restore  |
| 10 | Console clean                                               | ✅ no errors                                                             |
| 11 | Non-admin sees a 404                                        | ⚠️ **not covered** — needs a second Clerk account (see below)            |

## The finding that changed the design

The plan assumed `auth().orgId` on the server would carry the active
organization. Measured in the browser, it does not:

| Token                                      | Carries `org_id` |
| ------------------------------------------ | ---------------- |
| Client token (`session.getToken()`) — used by the Supabase client, so by **RLS** | ✅ yes |
| `__session` **cookie** — what the server's `auth()` reads                        | ❌ never, across refreshes and 70 s after activation |

Consequences and fixes:

1. **Server-side checks are now membership-authoritative.**
   `lib/admin/access.ts::isAdminRequest()` takes the active org as a fast path
   and otherwise asks Clerk whether the caller is a member of `ADMIN_ORG_ID`.
   The console layout and every admin action use it. Before this, a genuine
   admin got `NOT_FOUND` from every mutation while the page rendered fine.
2. **The proxy can no longer deny on the cookie alone.** A matching org
   short-circuits; anything else falls through to the layout (which resolves
   membership and 404s). Denying at the edge on a claim the cookie never
   carries would have bounced real admins in a redirect loop. Layer 1 still
   handles "signed out" and "no admin org configured".
3. **RLS is unchanged and works as specified** — `org_id` from the JWT,
   evaluated once per statement. But it only grants the fleet view while the
   organization is *active*, and an inactive org silently degrades to
   "your own rows" (an empty console, no error). `EnsureAdminOrgActive` in the
   console layout keeps the organization active and shows a skeleton until it
   is, so that state cannot be mistaken for an empty fleet.
4. **Activation uses Clerk's own navigation.** `setActive({ organization,
   redirectUrl })` navigates only once the session really carries the org;
   navigating manually after `await setActive(...)` raced the session sync and
   the organization never stuck.

Also fixed during verification: the admin layout originally wrapped
`/admin/activate` too, so it 404'd exactly the users that route exists for.
The gated routes now live in an `(console)` route group with `activate`
outside it.

## Not covered here

- **A real non-admin.** Every negative path is covered by unit tests (proxy,
  actions, gate states) and pgTAP (RLS visibility), but the end-to-end "a
  different signed-in human gets a 404" walk needs a second Clerk account —
  the same gap as the device-sharing verification.
- **Production.** `ADMIN_ORG_ID` must be set in Vercel/Infisical and
  `yarn admin:set-org` run against the production Supabase project; neither is
  done. A `db-reset` clears the Vault secret, so local development needs it
  re-set after each reset.
