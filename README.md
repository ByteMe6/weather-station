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

What the web app does today: live dashboard (Realtime), 24 h / 7 d / 30 d
charts, CSV export, station registration + sharing with roles, station
nickname/address, Telegram account linking, web-managed alerts, account
deletion, privacy policy. Bot-side pieces (`/register`, `/current`, the alert
dispatcher) are separate tickets.

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

### Responsive E2E (Playwright)

```bash
cd apps/web
yarn test:e2e:secrets    # signs in via Clerk testing token, seeds a device
```

Asserts at 390 px and 768 px that no route scrolls sideways, nothing is clipped
past the right edge, and every control clears 44 px. Requires a local Supabase
stack, a Clerk **development** instance (Testing Tokens do not work against
production), and `E2E_CLERK_USER_EMAIL` set to an account that exists in it —
no password is involved, the token is minted from the address alone. Add that
account to `ADMIN_ORG_ID` to cover the admin console; without it those specs
skip with a message rather than fail.

Setup seeds its own device, ownership link, a day of readings and — if the
column is still NULL — a Telegram id, so `/alerts` renders its real UI instead
of the "link Telegram" empty state.

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

### Admin console

`/admin` provisions and manages the fleet from the browser: create a device
(id + secret shown once), rotate a secret, unclaim or delete a device, and see
every device and user. Access is a single Clerk organization, configured in
**two places that must agree**:

```bash
# 1. Create the organisation in Clerk, add the admins to it, and copy its id.
# 2. App environment (Infisical / Vercel):
ADMIN_ORG_ID=org_xxxxxxxxxxxxxxxx

# 3. Supabase — the value RLS compares against, per environment:
cd infra/supabase-db
infisical run -- yarn admin:set-org org_xxxxxxxxxxxxxxxx
```

The console shows a red banner if the two drift apart. `yarn db-reset:local`
drops the Vault secret, so re-run `admin:set-org` after every local reset.

A member whose organisation is not active in the session is sent to
`/admin/activate`, which activates it once (Clerk only puts `org_id` in the
session token for the active organisation). Everyone else gets a 404 — the
console never advertises itself.

Device creation here replaces `yarn provision:device` for everyday use; the CLI
remains the way to emit a flashable NVS image.

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
