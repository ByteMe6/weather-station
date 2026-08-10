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

### Provision a device

Every device gets a `DEVICE_ID` (goes on the label) and a `DEVICE_SECRET`
(never leaves the device). Both are minted ahead of flashing and logged in the
`devices` table as `unregistered`:

```bash
cd infra/supabase-db
cp .env.example .env    # set SUPABASE_URL + SUPABASE_SECRET_KEY (service role)
yarn provision:device --emit-nvs /tmp/nvs.bin
```

Requires **Node ≥ 22.6** — the script runs the TypeScript directly via
`node --experimental-strip-types`, which older Node (incl. the repo's `>=20.9`
floor) does not support. `--emit-nvs` additionally needs
`pip install esp-idf-nvs-partition-gen`.

`--emit-nvs` writes the pair into a flashable NVS image instead of printing
the secret. **That is the supported path** — identity lives in the device's
NVS, not in the firmware binary, so one build serves the whole fleet and OTA
can target more than one device. Flash it with esptool at `0x9000`, then flash
the firmware; see **Provisioning identity** in `firmware/README.md` for the
full sequence.

Without `--emit-nvs` the script prints the pair to stderr instead. That is a
fallback for inspection only — do **not** put `DEVICE_ID` / `DEVICE_SECRET`
into `firmware/secrets.ini`, which no longer reads them. Either way the secret
is stored nowhere else in plaintext, so losing it means provisioning a new
device.

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
