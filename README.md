# Weather Station

Hyperlocal weather monitoring — ESP32 sensors, Next.js dashboard, Telegram bot.

## Repo structure

```
apps/
  web/        Next.js App Router (frontend + API routes) — deployed on Vercel
  bot/        Telegram bot (TypeScript, grammY) — deployed on Supabase Edge Functions
firmware/     ESP32 firmware (Arduino core + PlatformIO)
docs/         Project documentation
```

## Local dev setup

### Prerequisites

- Node.js 20+
- Yarn 1.x (`npm i -g yarn`)
- PlatformIO CLI (`pip install platformio`) — for firmware only

### Install dependencies

```bash
yarn install
```

This installs dependencies for all workspaces (`apps/web` and `apps/bot`) in one command.

### Run web app

```bash
yarn dev:web
```

Opens at http://localhost:3000. Requires `.env.local` in `apps/web/` — copy from `apps/web/.env.example`.

### Run bot locally

```bash
yarn dev:bot
```

Requires `.env` in `apps/bot/` with `BOT_TOKEN`. In dev, bot uses polling (not webhook).

### Lint & typecheck all workspaces

```bash
yarn lint
yarn typecheck
```

### Firmware

See [`firmware/README.md`](firmware/README.md) for toolchain setup and flash instructions.

## CI

GitHub Actions runs lint + typecheck on every PR targeting `main`. PRs must pass before merging.
