import { TELEGRAM_LINK_PREFIX } from '@ws/shared'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32 — no I, L, O, U

export const generateLinkCode = (): string => {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += ALPHABET[b % 32]
  return out
}

export const telegramDeepLink = (botUsername: string, code: string): string =>
  `https://t.me/${botUsername}?start=${TELEGRAM_LINK_PREFIX}${code}`
