import { createHash, randomBytes } from 'node:crypto'

/**
 * Our key format: a recognisable prefix (so a leaked key is greppable and
 * secret scanners can flag it) plus 32 random bytes as base64url — 43
 * characters, no padding. Provider-specific on purpose: nothing outside
 * lib/api/keys/own-* may assume it (spec §5.1).
 */
export const OWN_KEY_PREFIX = 'wsk_live_'

const KEY_BODY = /^[A-Za-z0-9_-]{43}$/

export const generateOwnKey = (): string =>
  `${OWN_KEY_PREFIX}${randomBytes(32).toString('base64url')}`

/** Cheap shape check, so garbage never costs a database round trip. */
export const isOwnKeyFormat = (token: string): boolean =>
  token.startsWith(OWN_KEY_PREFIX) &&
  KEY_BODY.test(token.slice(OWN_KEY_PREFIX.length))

/** Lowercase hex SHA-256 — the value stored in api_keys.key_hash. */
export const hashOwnKey = (key: string): string =>
  createHash('sha256').update(key, 'utf8').digest('hex')

export const ownKeyHint = (key: string): string => key.slice(-4)
