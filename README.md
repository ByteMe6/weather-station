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
yarn dev
```

Opens at http://localhost:3000. Requires `apps/web/.env.local` — copy from
[`apps/web/.env.example`](apps/web/.env.example) and fill in the Clerk +
Supabase dev keys.

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
