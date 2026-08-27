// Telegram bot — Supabase Edge Function, webhook mode (docs/04-prd.md OQ4).
//
// Deploy:    cd infra/supabase-db && yarn deploy:functions
// Local dev: cd infra/supabase-db && npx supabase functions serve telegram-bot \
//              --env-file supabase/functions/.env
//
// Command builders live in commands/ and return a neutral Reply; this file
// owns all grammY glue (T1–T5 routing).
import { Bot, InlineKeyboard, webhookCallback } from 'grammy'

import { serviceClient } from '../_shared/db.ts'
import { bitsToDays } from './alerts-parse.ts'
import {
  confirmRemoveReply,
  dayPickerReply,
  handleAlertCommand,
  listReply,
  saveSlot,
} from './commands/alerts.ts'
import { currentReply } from './commands/current.ts'
import { aboutReply, backRow, mainMenu, unknownReply } from './commands/menu.ts'
import { registerDevice, registerPrompt } from './commands/register.ts'
import { startReply } from './commands/start.ts'
import { ensureUserId } from './identity.ts'
import { handleLinkCode, LINK_PREFIX } from './link.ts'
import type { Reply } from './reply.ts'
import { listSlots, removeSlotById } from './schedules.ts'
import { clearSession, getSession, setSession } from './session.ts'

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

const toKeyboard = (reply: Reply): InlineKeyboard | undefined => {
  if (!reply.buttons) return undefined
  const kb = new InlineKeyboard()
  for (const row of reply.buttons) {
    for (const b of row) kb.text(b.text, b.data)
    kb.row()
  }
  return kb
}

const send = (
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  r: Reply,
) => ctx.reply(r.text, { reply_markup: toKeyboard(r) })

bot.command('start', async (ctx) => {
  const payload = ctx.match?.trim() ?? ''
  // Deep link from the web app's Telegram-linking flow (MRP-37).
  if (payload.startsWith(LINK_PREFIX) && ctx.from) {
    return ctx.reply(
      await handleLinkCode(payload.slice(LINK_PREFIX.length), ctx.from.id),
    )
  }
  return send(ctx, startReply())
})

bot.command('menu', (ctx) => send(ctx, mainMenu()))

bot.command('current', async (ctx) => {
  if (!ctx.from) return
  return send(ctx, await currentReply(serviceClient(), ctx.from.id))
})

bot.command('register', async (ctx) => {
  if (!ctx.from) return
  const db = serviceClient()
  if (!ctx.match?.trim()) {
    await setSession(db, ctx.from.id, { kind: 'awaiting_device_id' })
    return send(ctx, registerPrompt())
  }
  return send(ctx, await registerDevice(db, ctx.from.id, ctx.match))
})

bot.command('alert', async (ctx) => {
  if (!ctx.from) return
  return send(
    ctx,
    await handleAlertCommand(serviceClient(), ctx.from.id, ctx.match ?? ''),
  )
})

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data
  await ctx.answerCallbackQuery()
  if (!ctx.from) return
  if (data === 'menu:root') return send(ctx, mainMenu())
  if (data === 'menu:about') return send(ctx, aboutReply())
  if (data === 'menu:current')
    return send(ctx, await currentReply(serviceClient(), ctx.from.id))
  if (data === 'register:start') {
    await setSession(serviceClient(), ctx.from.id, {
      kind: 'awaiting_device_id',
    })
    return send(ctx, registerPrompt())
  }
  if (data === 'menu:alerts' || data.startsWith('alerts:')) {
    const db = serviceClient()
    const uid = ctx.from.id
    if (data === 'menu:alerts')
      return send(
        ctx,
        listReply(await listSlots(db, await ensureUserId(db, uid))),
      )
    if (data === 'alerts:add') return send(ctx, dayPickerReply('0000000'))
    if (data.startsWith('alerts:day:'))
      return send(ctx, dayPickerReply(data.slice('alerts:day:'.length)))
    if (data.startsWith('alerts:save:')) {
      const days = bitsToDays(data.slice('alerts:save:'.length))
      if (days.length === 0)
        return send(ctx, { text: 'Pick at least one day first.' })
      await setSession(db, uid, { kind: 'awaiting_alert_time', days })
      return send(ctx, {
        text: 'Now send the time as HH:MM (24-hour), e.g. 07:30.',
        buttons: [backRow()],
      })
    }
    if (data.startsWith('alerts:rm:')) {
      const id = Number(data.slice('alerts:rm:'.length))
      const slots = await listSlots(db, await ensureUserId(db, uid))
      const slot = slots.find((s) => s.id === id)
      return send(ctx, slot ? confirmRemoveReply(slot) : listReply(slots))
    }
    if (data.startsWith('alerts:rmc:')) {
      const id = Number(data.slice('alerts:rmc:'.length))
      const userId = await ensureUserId(db, uid)
      await removeSlotById(db, userId, id)
      return send(ctx, listReply(await listSlots(db, userId)))
    }
  }
  return send(ctx, unknownReply())
})

bot.on('message:text', async (ctx) => {
  if (!ctx.from) return
  const session = await getSession(serviceClient(), ctx.from.id)
  if (session?.kind === 'awaiting_device_id') {
    const db = serviceClient()
    await clearSession(db, ctx.from.id)
    return send(ctx, await registerDevice(db, ctx.from.id, ctx.message.text))
  }
  if (session?.kind === 'awaiting_alert_time') {
    const db = serviceClient()
    await clearSession(db, ctx.from.id)
    return send(
      ctx,
      await saveSlot(db, ctx.from.id, session.days, ctx.message.text.trim()),
    )
  }
  return send(ctx, unknownReply())
})

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
