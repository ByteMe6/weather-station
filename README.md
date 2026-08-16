# Weather Station

Hyperlocal weather monitoring — ESP32 sensors, Next.js dashboard, Telegram bot.

## Repo structure

```
apps/
  web/                Next.js App Router (dashboard + API routes) — deployed on Vercel
packages/
  shared/             Shared types & constants (readings, devices, ingest contract)
  eslint-config/      Shared ESLint preset (@ws/eslint-config/base)
  tsconfig/           Shared TypeScript presets (base, nextjs)
infra/
  supabase-db/        Database package: migrations, generated types, service-role
                      client, and Supabase Edge Functions (telegram-bot)
firmware/             ESP32 firmware (Arduino core + PlatformIO)
docs/                 Project documentation
```

Conventions, data-path rules, and per-domain guides: see [CLAUDE.md](CLAUDE.md).

## Local dev setup

### Prerequisites

- Node.js 20.9+ with corepack (`corepack enable` — activates Yarn 4 automatically)
- Supabase CLI (installed as a dev dependency — used via `npx supabase`)
- Deno 2.x — only for working on the Telegram bot edge function
- PlatformIO (`pipx install platformio`) — only for firmware

### Install dependencies

```bash
corepack enable   # once per machine
yarn install
```

### Run the web app

```bash
infisical run -- yarn workspace @ws/web dev
```

Opens at http://localhost:3000 (Infisical injects the Clerk + Supabase keys; a
gitignored `apps/web/.env.local` copied from
[`apps/web/.env.example`](apps/web/.env.example) works as a fallback).

The dashboard reads Supabase directly from the browser with the Clerk session
token, so two one-time settings are required:

- **Supabase → Clerk third-party auth**: `infra/supabase-db/supabase/config.toml`
  `[auth.third_party.clerk]` (local) / Authentication → Third-party auth (hosted),
  pointing at the Clerk Frontend API domain.
- **Clerk → session token claim**: Configure → Sessions → Customize session
  token → `{"role": "authenticated"}` (or Integrations → Supabase). Without it
  every RLS query runs as `anon`.

Design spec and plans: `docs/superpowers/specs/2026-08-15-web-dashboard-ui-design.md`,
`docs/superpowers/plans/2026-08-15-web-plan-1-foundation-mvp.md`, `…-plan-2-….md`;
mockups in `docs/superpowers/mockups/2026-08-15-ui-direction/`.

### Run the Telegram bot locally

The bot is a Supabase Edge Function (Deno, webhook mode — see
`docs/04-prd.md` OQ4):

```bash
cd infra/supabase-db
cp supabase/functions/.env.example supabase/functions/.env   # set BOT_TOKEN
npx supabase functions serve telegram-bot --env-file supabase/functions/.env
```

### Lint / typecheck / test / build

```bash
yarn lint
yarn check-types
yarn test:unit
yarn build
yarn format        # prettier — CI enforces format:check
```

### Provision a device

Every device is flashed with a `DEVICE_ID` (goes on the label) and a
`DEVICE_SECRET` (never leaves the device). Both are minted ahead of flashing
and logged in the `devices` table as `unregistered`:

```bash
cd infra/supabase-db
cp .env.example .env    # set SUPABASE_URL + SUPABASE_SECRET_KEY (service role)
yarn provision:device
```

Requires **Node ≥ 22.6** — the script runs the TypeScript directly via
`node --experimental-strip-types`, which older Node (incl. the repo's `>=20.9`
floor) does not support.

It prints the pair once — copy them into `firmware/secrets.ini` before
flashing. The secret is shown only here and is stored nowhere else in
plaintext, so if you lose it you have to provision a new device.

### Firmware

See [`firmware/README.md`](firmware/README.md) for toolchain setup, the
`secrets.ini` flash-time config workflow, and flash instructions.

## CI

GitHub Actions runs on every PR **and on every push to `main`**:

- **checks** — format check, lint, typecheck, unit tests, and builds for all
  yarn workspaces (turbo)
- **edge-functions** — `deno check` + `deno lint` for the Telegram bot
- **firmware** — PlatformIO build (`pio run`)

PRs must pass before merging.
