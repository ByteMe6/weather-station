---
name: verify
description: Verify weather-station changes end-to-end — pick the right checks for the touched area (web/shared/db packages, Telegram bot edge function, or firmware) and actually exercise the change, not just typecheck it.
---

# Verifying changes in weather-station

Always finish with the full static pipeline from the repo root:

```bash
yarn lint && yarn check-types && yarn test:unit && yarn build && yarn format:check
```

Then exercise the change by area — a green pipeline alone does not prove
behavior:

## apps/web (pages, components, API routes)

1. `yarn dev` (background), wait for "Ready", open http://localhost:3000.
2. Drive the affected page/flow in a browser (Chrome/Playwright tools) and
   confirm the actual behavior changed as intended.
3. For API routes (`app/api/**`): `curl` the route with realistic payloads —
   for `/api/readings`, include the `x-device-id`, `x-signature`,
   `x-timestamp` headers (constants in `packages/shared`) and verify both the
   accept path and a 401 reject path (bad signature, stale timestamp).

## packages/shared

1. Unit tests are the primary check: `yarn workspace @ws/shared test:unit`.
2. Grep consumers (`apps/web`, edge functions) for the changed export and
   re-run their checks — shared types break at the edges, not in the package.

## infra/supabase-db (migrations, RLS, client)

1. `cd infra/supabase-db && yarn db-reset:local` (requires `supabase start`).
2. `yarn regenerate:types` — then `yarn check-types` from root must stay green.
3. If RLS changed: run `yarn test:db` (pgTAP). A policy change without a
   pgTAP test proving user isolation is NOT verified.

## Telegram bot (infra/supabase-db/supabase/functions/telegram-bot)

1. `deno check index.ts && deno lint` in the function directory.
2. `npx supabase functions serve telegram-bot --env-file supabase/functions/.env`
   and POST a sample Telegram update with the
   `X-Telegram-Bot-Api-Secret-Token` header; confirm 200 with the header and
   rejection without it.

## firmware/

1. `cd firmware && cp secrets.ini.example secrets.ini && pio run` — must link.
   If PlatformIO is not installed locally, say so explicitly and rely on the
   CI `firmware` job; do not claim the firmware was verified.
