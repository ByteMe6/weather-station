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

/**
 * The linking deep link, or null when the configured username is unusable.
 *
 * Returns null rather than a string on purpose: this used to normalise without
 * validating, so `telegramDeepLink('my bot', code)` produced a URL with a raw
 * space in it — rendered into the anchor *and* the QR code, doing nothing when
 * tapped and reporting nothing anywhere. That is the same silent failure the
 * normalisation was added to remove, so the guard is structural here rather
 * than left to whichever caller remembers.
 */
export const telegramDeepLink = (
  botUsername: string,
  code: string,
): string | null => {
  const username = normalizeBotUsername(botUsername)
  return isValidBotUsername(username)
    ? `https://t.me/${username}?start=${TELEGRAM_LINK_PREFIX}${code}`
    : null
}

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

/**
 * The configured bot username, normalised and validated, or null.
 *
 * Both the server action (deep link) and the settings card (chat link) need
 * this, and each used to normalise and validate its own copy. Next inlines
 * `NEXT_PUBLIC_*` into both bundles at build time, so the two cannot disagree
 * within a deployment — but two copies of the same rules could drift as either
 * side was edited, and the whole point of the normalisation is that both links
 * in that card resolve to the same bot.
 */
export const configuredBotUsername = (): string | null => {
  const username = normalizeBotUsername(
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? '',
  )
  return isValidBotUsername(username) ? username : null
}
