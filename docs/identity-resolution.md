# Identity resolution (PRD OQ3)

**Status:** decided, implemented — MRP-39.
**Code:** `merge_telegram_identity()`
(`infra/supabase-db/supabase/migrations/20260827221145_merge_telegram_identity.sql`),
called from `supabase/functions/telegram-bot/link.ts`.

## The problem

A `users` row can be created down either of two independent paths:

| Path                          | Creates                                    | Where                                     |
| ----------------------------- | ------------------------------------------ | ----------------------------------------- |
| Clerk sign-up on the web      | row with `clerk_user_id`, `telegram_id` null | `ensureCurrentUserAction`                 |
| First contact with the bot    | row with `telegram_id`, `clerk_user_id` null | `ensureUserId` (`telegram-bot/identity.ts`) |

One human who does both gets two rows. `users.clerk_user_id` and
`users.telegram_id` are each `unique`, so nothing at the schema level stops
this — and nothing should, because at insert time the two paths genuinely
cannot tell they are the same person.

The damage showed up at linking. The web mints a one-time code, the user taps
the deep link, and the bot used to finish with:

```sql
update users set telegram_id = <id> where id = <clerk row>
```

When a telegram-only row already held that `telegram_id`, this raised `23505`
and the bot answered *"This Telegram account is already linked to another
user."* — which was false, dead-ended the user, and could only be cleared by
hand-written SQL against production.

## The decision

**Linking is the single merge path, and the Clerk row always survives.**

There is deliberately no separate "merge accounts" screen or command. Holding a
Clerk session *and* receiving the one-time code inside the Telegram chat already
proves control of both identities; that pair of proofs is the authorisation, so
the merge runs silently as part of linking rather than asking again.

The Clerk row survives because it carries the sign-in identity, it is what
account deletion (MRP-40) operates on, and it is the only one of the two that a
person can recover if they lose access to the other.

`merge_telegram_identity(p_user_id, p_telegram_id)` does all of it in one
transaction:

1. Lock the surviving row; lock the absorbed one second (a fixed order, so two
   concurrent links cannot deadlock).
2. Upgrade the survivor's role on any device both rows have — `owner` >
   `editor` > `viewer`, so a merge never demotes anyone.
3. Move device memberships the survivor lacks.
4. Move alert slots, skipping ones identical in `(time, timezone, days)`.
5. Delete the absorbed row. The `on delete cascade` on `device_users`,
   `schedules` and `telegram_link_codes` clears whatever was left behind.
6. Claim `telegram_id` on the survivor — last, once the unique index is free.

It returns `(merged, devices_moved, schedules_moved)` so the bot can tell the
user what came across instead of moving their stations in silence.

## Which identity wins

| Question                                    | Answer                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| Which `users` row survives?                 | The Clerk one, always.                                      |
| Who owns devices after a merge?             | The surviving row, at the stronger of the two roles.        |
| Whose alert slots survive?                  | Both sets, minus exact duplicates.                          |
| What does the bot resolve to afterwards?    | The same surviving row — it looks up by `telegram_id`, which now lives there. |
| Are duplicate rows left behind?             | No. The absorbed row is deleted, not tombstoned.            |

## Refusals

Two cases are never merged, and both raise `P0001` for the bot to map:

- **`ALREADY_LINKED_OTHER`** — the web account already points at a *different*
  Telegram account. Silently repointing it would strip alerts from a chat that
  is still receiving them, so unlinking on the web stays the deliberate way out.
- **`TELEGRAM_BELONGS_TO_ACCOUNT`** — the Telegram id belongs to a row that has
  its own `clerk_user_id`, i.e. another human's web account. Absorbing that
  would hand over their stations. This is the one case where the original
  *"already linked to another user"* message was telling the truth, and it
  keeps that message.

Re-running the identical link is an idempotent no-op, not an error.

## One claimable check, not two

MRP-39 also required that the two registration flows not drift apart. They do
not: `registerDeviceAction` (web) and `registerDevice` (bot) both call the same
`claim_device()` RPC, which is where `DEVICE_NOT_FOUND` /
`DEVICE_ALREADY_CLAIMED` and the one-owner-per-device rule live. Neither
runtime re-implements the predicate, so there is one place to change it.

## Unlinking, afterwards

Unlinking nulls `telegram_id` on the surviving row; devices and alerts stay
with the web account. The next message to the bot creates a fresh telegram-only
row with nothing in it, and re-linking absorbs that empty row again — reported
as `merged = true` with zero counts. This is coherent, but it does mean
**unlink then re-link is not a way to move stations back to a Telegram-only
account**; that would need an explicit un-merge, which is deliberately not built.

## Tests

`infra/supabase-db/supabase/tests/merge_telegram_identity.sql` (26 assertions)
covers the privilege posture, every input guard, the plain-link and idempotent
paths, both refusals, and the full merge: role upgrade, role preservation,
cascade of duplicate memberships, alert de-duplication, and the absence of
orphan rows. `supabase/functions/tests/link.test.ts` covers the reply and
error-mapping builders.
