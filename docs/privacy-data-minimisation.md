# Data-minimisation review (MRP-41)

Every stored personal field, why it exists, how long it lives. Reviewed
2026-08-15 against the schema in `infra/supabase-db/supabase/migrations/`.

| Where | Field | Why | Retention | Verdict |
| --- | --- | --- | --- | --- |
| `users` | `clerk_user_id` | Maps the Clerk session (JWT `sub`) to an internal id for RLS | Until account deletion (cascade) | Required |
| `users` | `telegram_id` | Bot identifies the user; alerts delivered to it | Until unlink or account deletion | Required for Telegram features; nullable, opt-in |
| `device_users` | `user_id`, `role`, `added_at` | Who may see/manage a station | Until removed or account deletion | Required |
| `schedules` | `user_id`, `time`, `timezone`, `days` | Alert slots the user asked for | Until deleted or account deletion | Required |
| `telegram_link_codes` | `user_id`, code, timestamps, `failed_reason` | One-time proof of Telegram ownership | 10-minute TTL; row removed on account deletion (cascade); consumed/expired rows are inert | Required; consider a nightly purge of rows older than 1 day (nice-to-have) |
| `devices` | `label`, `address` | Owner-entered nickname/address for a station | Until owner edits or the device is re-provisioned | Optional, user-entered, not tied to a person once the account is gone |
| `devices` | `latitude`, `longitude` | Draw the owner's own stations on a map (`/devices`) | Until the owner clears them or the device is re-provisioned | Optional, user-entered, never geocoded or sent to a third party |
| `api_keys` | `user_id`, `name`, `key_hash`, `key_hint`, `scope`, timestamps | Personal API keys for the user's own scripts; only a SHA-256 of the key is stored | Until account deletion (cascade); revoked keys stay listed (no secret) so Settings can show them | Required for the public API; opt-in |
| `readings` | sensor values, `device_id`, `timestamp` | The product | 12 months raw, then daily aggregates (MRP-36) | Not personal data on its own; becomes unlinked when accounts are deleted |
| Clerk (external) | email, name, avatar | Sign-in | Managed by Clerk; deleted with the account | Not copied into our DB |

Device hand-over: when the last member leaves a station (an owner removing
their account, or an admin unclaiming it) the nickname, address and map
coordinates are purged by `maintain_device_status()`, so a re-claimed device
carries nothing personal into the next tenancy. Readings survive, as they do on
account deletion, because they are device-scoped weather values — and once the
address and coordinates are gone they are unlabelled numbers.

Admin console: members of the Clerk organization named by `ADMIN_ORG_ID` can
read every device, reading and — through the `admin_devices()` /
`admin_users()` RPCs — every account row — including full `clerk_user_id` / `telegram_id`
values, which ordinary station owners cannot see. The console displays only
4-character tails, but the underlying rows are readable, so admin membership is
a privileged role and should stay small. `telegram_link_codes` is excluded from
the bypass. Narrowing this later means dropping one policy per table.

Who sees whose identifiers: `users` is readable only by its own row
(`users can view own profile`). A station owner sees other members through
the `device_members()` RPC, which returns the **last four characters** of
`clerk_user_id` / `telegram_id` — enough to tell people apart, not enough to
address them. The API never returns a member's full identifier to another
user (proven in `supabase/tests/device_sharing.sql`).

Public API: anyone holding a user's API key reads every station that user can
see, including nickname, address and coordinates. A key embedded in a
website's JavaScript is public; Settings warns about this and recommends a
read-only key or a server-side call. Keys are revocable instantly and never
reveal member identities.

Conclusion: nothing stored is unjustified — no removal tickets. Follow-ups:
purge stale `telegram_link_codes` nightly once pg_cron work (MRP-36) lands;
replace the placeholder `privacy@example.com` with the real contact before
launch (also in `apps/web/src/components/legal/PrivacyPolicy.tsx`).
The bot's `/start`/About should link to `/privacy` **[verify when MRP-20 lands]**.
