// Telegram bot — Supabase Edge Function, webhook mode (docs/04-prd.md OQ4).
//
// Deploy:    cd infra/supabase-db && yarn deploy:functions
// Local dev: cd infra/supabase-db && npx supabase functions serve telegram-bot \
//              --env-file supabase/functions/.env
//
// Command handlers (T1–T7) land in subsequent tickets.
import { Bot, webhookCallback } from 'grammy'

const token = Deno.env.get('BOT_TOKEN')
if (!token) {
  throw new Error('BOT_TOKEN is not set — see supabase/functions/.env.example')
}

// Fail closed: without the secret, webhookCallback would skip the
// X-Telegram-Bot-Api-Secret-Token check and (with verify_jwt = false at the
// gateway) leave the endpoint open to forged updates.
const webhookSecret = Deno.env.get('BOT_WEBHOOK_SECRET')
if (!webhookSecret) {
  throw new Error(
    'BOT_WEBHOOK_SECRET is not set — see supabase/functions/.env.example',
  )
}

const bot = new Bot(token)

bot.command('start', (ctx) =>
  ctx.reply('Weather Station bot — registration flow coming soon.'),
)

const handleUpdate = webhookCallback(bot, 'std/http', {
  secretToken: webhookSecret,
})

Deno.serve(async (req) => {
  try {
    return await handleUpdate(req)
  } catch (err) {
    console.error('telegram-bot webhook error', err)
    return new Response('internal error', { status: 500 })
  }
})
