---
name: new-migration
description: Create a Supabase migration the project way — UTC-timestamped file via yarn migrate:new, RLS policies and indexes per CLAUDE.md rules, regenerated types, and a pgTAP test for any RLS change.
---

# Creating a database migration

All commands run from `infra/supabase-db/`.

1. **Create the file** (never hand-name it — the CLI stamps the required UTC
   `YYYYMMDDHHmmss_<name>.sql` format):

   ```bash
   yarn migrate:new <snake_case_name>
   ```

2. **Write the SQL**, applying the CLAUDE.md database rules in the same
   migration as the table:
   - RLS enabled + policies for every user-facing table; access goes through
     `device_users` membership
   - `devices.secret` (HMAC keys) must never be readable by any user-facing
     policy — service-role only
   - Policies use `auth.uid()` / no-arg `STABLE` helpers — no per-row
     function calls; nullable comparisons use `IS DISTINCT FROM`
   - Required indexes: `(device_id, timestamp DESC)` for reading-series
     tables, btree on every FK column, `(user_id)` for RLS equality;
     use `CREATE INDEX IF NOT EXISTS`

3. **Apply and regenerate types** (types MUST be committed with the
   migration):

   ```bash
   yarn migrate:up          # or yarn db-reset:local before running tests
   yarn regenerate:types
   ```

4. **pgTAP test** — any new table with RLS gets a test in
   `supabase/tests/` proving user A cannot read user B's rows. Assertions
   use `SELECT ok(...)` (never `PERFORM` inside `DO`). Run with
   `yarn test:db`.

5. **Verify from repo root**: `yarn check-types && yarn lint` — regenerated
   `database.ts` must not break consumers.
