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
  // `setWebhook` answers `result: true` while `getWebhookInfo` answers an
  // object, so this cannot be narrowed here without lying about one of them.
  result?: unknown
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
  // Not res.json() straight away: a 502 from Telegram, or a proxy block page,
  // is HTML, and parsing it would fail with `Unexpected token '<'` in the one
  // script written to make "why is the bot dead" easy to answer.
  if (!res.ok) {
    throw new Error(
      `${method} failed: HTTP ${res.status} — ${await res.text()}`,
    )
  }
  const json = (await res.json()) as TelegramResponse
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`)
  return typeof json.result === 'object' && json.result !== null
    ? (json.result as Record<string, unknown>)
    : {}
}

await call('setWebhook', {
  url,
  secret_token: BOT_WEBHOOK_SECRET,
  // Telegram delivers only what is listed here, so this list — not the code —
  // decides what reaches the bot. It must stay in step with the handlers
  // registered in supabase/functions/telegram-bot/index.ts; adding one there
  // without adding it here makes the new handler look broken with no error on
  // either side.
  allowed_updates: ['message', 'callback_query'],
  // Deliberately NOT dropping the backlog. The reason to run this script is
  // usually that the secret drifted and Telegram has been getting 401s, so the
  // queue is exactly the `/start link_<code>` taps that never arrived. Dropping
  // them would discard the users this is meant to rescue; Telegram redelivers
  // them to the now-correct webhook instead.
  drop_pending_updates: false,
})

// Which bot the token belongs to. BOT_TOKEN and NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
// are configured independently and nothing cross-checks them, so a dev token
// happily wires bot A's webhook while the dashboard deep-links bot B — and
// getWebhookInfo reports no error, because bot A is genuinely healthy. Printing
// the resolved username is what makes that visible.
const me = await call('getMe')
console.error(`bot: @${me.username}`)

const info = await call('getWebhookInfo')
console.error(`webhook set to ${info.url}`)
if (typeof info.pending_update_count === 'number')
  console.error(`pending updates queued: ${info.pending_update_count}`)
// last_error_message is where a wrong secret, a 401 or a cold-start failure
// shows up. Read it as history: this call lands milliseconds after setWebhook,
// so anything reported here describes the PREVIOUS registration — which is
// still the useful signal when diagnosing why the bot went quiet, as long as
// nobody reads it as a verdict on the registration just made. Re-run this
// command after a minute to judge the new one.
if (info.last_error_message)
  console.error(
    `last error from Telegram (previous registration): ${info.last_error_message}`,
  )
