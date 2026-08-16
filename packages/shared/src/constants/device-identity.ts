import { randomBytes } from 'node:crypto'

/**
 * Device identity is minted in exactly one place so the admin console and the
 * provisioning CLI cannot drift. `ws-` + 12 hex keeps the id short enough to
 * print on a label and type by hand; the secret is a 256-bit HMAC key.
 *
 * Server-side only (node:crypto). Exposed as the `@ws/shared/device-identity`
 * subpath as well as through the barrel: the CLI runs under plain Node type
 * stripping, which needs a concrete file, not a directory import.
 */
export const generateDeviceId = (): string =>
  `ws-${randomBytes(6).toString('hex')}`

export const generateDeviceSecret = (): string =>
  randomBytes(32).toString('hex')
