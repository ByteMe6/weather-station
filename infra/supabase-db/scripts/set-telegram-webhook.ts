// Points Telegram at the deployed telegram-bot edge function.
//
//   yarn bot:set-webhook https://<ref>.supabase.co/functions/v1/telegram-bot
//
// The secret token matters as much as the URL: index.ts passes
// BOT_WEBHOOK_SECRET to grammY's webhookCallback, which answers 401 to every
// update that does not carry a matching X-Telegram-Bot-Api-Secret-Token. A
// webhook registered without it - or with a stale one - makes the bot look
// dead rather than broken: /start never runs, so account linking sits at
// "Waiting for Telegram..." until the code expires. Registering both in the
// same call is the only way they cannot drift apart.
const { BOT_TOKEN, BOT_WEBHOOK_SECRET } = process.env
const url = process.argv[2]

if (!BOT_TOKEN || !BOT_WEBHOOK_SECRET) {
  throw new Error(
    'Set BOT_TOKEN and BOT_WEBHOOK_SECRET first (the same values the function has).',
  )
}
if (!url?.startsWith('https://')) {
  throw new Error(
    'Usage: yarn bot:set-webhook https://<ref>.supabase.co/functions/v1/telegram-bot',
  )
}

interface TelegramResponse {
  ok: boolean
  description?: string
  result?: Record<string, unknown>
}

const call = async (
  method: string,
  body?: unknown,
): Promise<Record<string, unknown>> => {
  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    },
  )
  const json = (await res.json()) as TelegramResponse
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`)
  return json.result ?? {}
}

await call('setWebhook', {
  url,
  secret_token: BOT_WEBHOOK_SECRET,
  allowed_updates: ['message', 'callback_query'],
  // Deliberately NOT dropping the backlog. The reason to run this script is
  // usually that the secret drifted and Telegram has been getting 401s, so the
  // queue is exactly the `/start link_<code>` taps that never arrived. Dropping
  // them would discard the users this is meant to rescue; Telegram redelivers
  // them to the now-correct webhook instead.
  drop_pending_updates: false,
})

const info = await call('getWebhookInfo')
console.error(`webhook set to ${info.url}`)
// last_error_message is where a wrong secret, a 401 or a cold-start failure
// shows up; it is the first thing to read when the bot stops answering.
if (info.last_error_message)
  console.error(`last error from Telegram: ${info.last_error_message}`)
