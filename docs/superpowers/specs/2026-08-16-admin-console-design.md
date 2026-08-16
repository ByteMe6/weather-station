# Admin console — design

**Date:** 2026-08-16
**Status:** approved for planning
**Supersedes for day-to-day use:** `infra/supabase-db/scripts/provision-device.ts` (the CLI stays for NVS image generation)

## 1. Goal

Members of one Clerk organization can provision and run the station fleet from
the web app: create a device (id + HMAC secret), see every device and user,
rotate a secret, and delete or unclaim a device — without a terminal and
without anyone handing around the service-role key.

Not a goal: multi-tier admin roles, audit-log UI, editing readings, or
impersonating users.

## 2. Who is an admin

A single Clerk **organization id** decides. It lives in two stores because two
independent enforcers need it, and it is in neither git nor the client bundle:

| Store                                   | Read by                        | Set by                                                     |
| --------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `ADMIN_ORG_ID` (server env)             | Server actions (`auth().orgId`) | Infisical / Vercel env                                      |
| Supabase Vault secret `admin_org_id`    | RLS via `public.is_admin_request()` | `yarn admin:set-org <org_id>` locally; Supabase CLI/dashboard in prod |

**Drift between the two splits the enforcers**, so:

- `getAdminStatusAction()` compares them and reports a `configMismatch` flag;
  the admin shell renders a loud banner when it is set.
- An integration test asserts the Vault value equals `process.env.ADMIN_ORG_ID`.

Migrations never contain an org id. They create the reader function only; the
value is an ops step per environment. A missing Vault secret makes
`is_admin_request()` return `false` — the system fails closed.

## 3. Three enforcement layers

Access is checked in three independent places; each one alone is sufficient to
deny, and none trusts the layer above it.

| # | Layer                                    | Check                                                                     | Failure                                       |
| - | ---------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| 1 | `apps/web/src/proxy.ts` (Next 16 proxy)  | `/admin(.*)` except `/admin/activate` requires `orgId === ADMIN_ORG_ID`   | Redirect to `/admin/activate` — nothing renders, no data is fetched, no RSC payload is produced |
| 2 | `app/(app)/admin/layout.tsx`             | Same comparison server-side, from `auth()`                                | `notFound()` (404)                            |
| 3 | Every admin server action                | Same comparison, re-derived per call                                      | `actionError('NOT_FOUND', …)`                 |

Layer 1 is the cheap edge gate the request never gets past. Layer 2 covers any
matcher gap and direct RSC requests. Layer 3 is the actual security boundary —
an action must never assume it was reached through the page.

`ADMIN_ORG_ID` is read from `process.env` in the proxy; when it is unset every
`/admin` request is redirected, so an unconfigured environment has no admin
surface at all.

## 4. The activation step (not optional)

Clerk's session token carries a top-level `org_id` claim (token `v: 2`,
verified against the running dev instance), **but only when an organization is
active for the session**. A user who merely belongs to the admin org gets
`org_id: null` and would be invisible to both enforcers.

This is why the proxy redirects rather than 404s: a genuine admin whose org is
merely inactive must have somewhere to go. That somewhere is `/admin/activate`,
the one `/admin` path exempt from layer 1, which runs a three-state gate:

```
getAdminStatusAction() →
  { state: 'ok' }                        → redirect to /admin
  { state: 'needs-activation', orgId }   → setActive({ organization: orgId }), then /admin
  { state: 'denied' }                    → notFound()
```

`needs-activation` is decided server-side by listing the caller's Clerk
organization memberships; the org id it returns is not a secret (the user can
already see it in their own memberships). `denied` renders a **404, not a 403**
— a non-admin who probes `/admin` is redirected to `/admin/activate` and gets a
404 there, learning nothing about whether the console exists.

After `setActive`, Clerk mints a new session token. `useSupabaseClient()`
re-runs its `accessToken` callback on every request, so RLS sees the new
`org_id` without a page reload.

## 5. RLS — the per-request rule

```sql
create or replace function public.is_admin_request()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select decrypted_secret from vault.decrypted_secrets where name = 'admin_org_id')
      = (auth.jwt() ->> 'org_id'),
    false
  );
$$;
```

Every admin policy is exactly:

```sql
create policy "admin org can view all <table>"
  on public.<table> for select to authenticated
  using ((select public.is_admin_request()));
```

The predicate references **no row column**, so Postgres hoists it into a single
InitPlan per statement instead of calling it per row. This is the hard rule for
this feature, and it is tested, not assumed: a pgTAP case runs
`EXPLAIN (format json)` on an admin-scoped select and asserts the plan contains
an `InitPlan` and no correlated `SubPlan`. (The earlier sharing migration failed
exactly this test by passing a row column into the helper.)

Policies are permissive, so they OR with the existing per-user policies; a
normal user's visibility is unchanged.

**Tables covered:** `devices`, `device_users`, `readings`, `users`, `schedules`.
**Not covered:** `telegram_link_codes` stays service-role only — one-time link
codes have no admin use case and are the one table whose contents let someone
hijack an identity link.

## 6. Secrets

The admin bypass grants **row** visibility. `devices.secret` is withheld by a
**column grant**, which no row policy can override, so an admin's browser still
cannot read a secret — the guarantee in CLAUDE.md is untouched and no migration
in this work grants that column.

A secret is returned in exactly two responses, both from server actions:

- `createDeviceAction()` → `{ deviceId, secret }`
- `rotateDeviceSecretAction({ deviceId })` → `{ secret }`

The UI shows each once, with copy buttons and a "shown once" warning, and holds
it only in component state. The device list has no code path that can reach a
secret. Losing one is recoverable by rotating, which is why "show on demand"
was rejected: it would turn every admin session into a standing key-exfiltration
path for the whole fleet.

Id and secret generation move to `@ws/shared` (`generateDeviceId()`,
`generateDeviceSecret()`), so the web action and the provisioning CLI mint
identically instead of drifting apart.

## 7. Data paths

| Operation                              | Path                    | Why                                                                                    |
| -------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| List devices, users, readings health    | Client + RLS bypass     | Ordinary queries through `useSupabaseClient()`; the bypass is the whole point           |
| Create device, rotate secret            | Server action           | Mints a secret — can never run client-side                                              |
| Delete device, unclaim device           | Server action           | Destructive writes stay behind one audited entry point rather than an RLS DELETE policy |

Every admin server action re-derives `orgId` from `auth()` and compares it to
`ADMIN_ORG_ID` itself. The page gate is convenience; the action check is the
security boundary. Actions return the existing `ActionResult` union and are
consumed through TanStack hooks with `unwrapAction`, like every other action in
the app.

## 8. Screens

**`/admin`** — devices table: device id, label, status, owner count, created,
last reading (with a stale marker). Actions: **Create device** (dialog →
one-time secret), and per row **Rotate secret**, **Unclaim** (delete the
`device_users` rows; the existing `maintain_device_status()` trigger flips the
status back to `unregistered`), **Delete** (removes the device and, by cascade,
its readings — typed confirmation required).

**`/admin/users`** — users table: masked identifier tails, Clerk display name
(resolved through the existing `fetchClerkProfiles` server-side lookup),
Telegram linked yes/no, station count, joined date. Read-only.

Both live under an `/admin` layout that runs the gate once and renders an
"Admin" nav entry visible only to admins.

## 9. Privacy consequence (deliberate)

Putting `users` in the bypass means an admin's browser can read full
`clerk_user_id` and `telegram_id` values — the exact exposure that was removed
for station owners by masking to four-character tails. For a fleet
administrator this is defensible, but it is a real widening: it goes in
`docs/privacy-data-minimisation.md`, the admin UI still displays masked tails,
and dropping `users` from the bypass later is a one-line policy change.

## 10. Testing

| Layer       | Coverage                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| pgTAP       | `is_admin_request()` is STABLE, SECURITY DEFINER, `search_path=''`; returns false with no Vault secret, false for a non-matching `org_id`, true for a matching one; admin sees all rows of each covered table while a normal user still sees only their own; `telegram_link_codes` stays unreadable; **EXPLAIN asserts InitPlan, no correlated SubPlan**; `devices.secret` still ungranted. |
| Integration | An admin JWT (test helper extended with `org_id`) reads every device/user/reading; a normal JWT sees only its own; secret column still unreadable for both; Vault value equals `ADMIN_ORG_ID`.                              |
| Unit        | Each server action: rejects no session, rejects a non-admin org, rejects a member of a different org; create returns a well-formed id/secret and retries on `23505`; rotate replaces the secret; delete/unclaim guard input with zod; the three-state gate maps to ok/needs-activation/denied. |
| Browser     | Admin sees the console and the nav entry; a non-admin gets 404; create shows the secret once and never again; rotate, unclaim and delete each behave; the config-mismatch banner appears when the two stores disagree.       |

## 11. Risks

| Risk                                                                     | Mitigation                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Vault secret set in one environment but not another                      | Fails closed (no admin access); the mismatch banner and integration test surface it                               |
| An admin leaves the org but keeps an unexpired session token             | Clerk session tokens are short-lived (60 s) and `org_id` disappears on the next mint; server actions re-check every call |
| A future migration adds a blanket `grant select on public.devices`       | pgTAP asserts `secret` stays ungranted; the rule is already documented in CLAUDE.md and the init migration        |
| Someone adds an admin policy that passes a row column into the helper    | The EXPLAIN test fails — that is precisely what it exists to catch                                                |
| Deleting a device destroys its readings                                  | Typed confirmation naming the device id, and the dialog states the reading count that will be removed             |
