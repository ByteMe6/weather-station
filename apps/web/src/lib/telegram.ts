import { TELEGRAM_LINK_PREFIX } from '@ws/shared'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 — no I, L, O, U

export const generateLinkCode = (): string => {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}

/**
 * BotFather shows the username as `@WsWeatherBot` and links the bot as a t.me
 * URL, and both get pasted verbatim into NEXT_PUBLIC_TELEGRAM_BOT_USERNAME.
 * Either one used to go straight into the deep link, and
 * `https://t.me/@WsWeatherBot?start=link_…` does not open the bot — the user
 * tapped "Open in Telegram", nothing happened, and the settings card waited
 * out the whole TTL with no error on any side. Normalise to the bare username
 * here; `isValidBotUsername` decides whether what is left is usable.
 */
export const normalizeBotUsername = (raw: string): string =>
  raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:t|telegram)\.me\//i, '')
    .replace(/^@/, '')
    .replace(/[?#/].*$/, '')
    .trim()

/** Telegram usernames are 5–32 characters of `[A-Za-z0-9_]`. */
export const isValidBotUsername = (username: string): boolean =>
  /^[A-Za-z0-9_]{5,32}$/.test(username)

export const telegramDeepLink = (botUsername: string, code: string): string =>
  `https://t.me/${normalizeBotUsername(botUsername)}?start=${TELEGRAM_LINK_PREFIX}${code}`

/**
 * Public chat link for the configured bot, or null when the value is unusable.
 * Shares the normalisation with `telegramDeepLink` on purpose: the two links
 * sit next to each other in the settings card, and fixing only one of them
 * left the other rendering `https://t.me/@WsWeatherBot`, which silently does
 * nothing when tapped.
 */
export const botChatUrl = (configured: string): string | null => {
  const username = normalizeBotUsername(configured)
  return isValidBotUsername(username) ? `https://t.me/${username}` : null
}
