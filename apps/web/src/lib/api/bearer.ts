/** Real keys are ~52 characters; anything this long is not one, so it is never hashed. */
const MAX_TOKEN_LENGTH = 256
const BEARER = /^Bearer[ \t]+(\S+)$/i

/**
 * The raw token from an `Authorization: Bearer <token>` header, or null.
 * Knows nothing about key formats — the provider decides what a key looks like.
 */
export const parseBearer = (header: string | null): string | null => {
  if (!header) return null
  const token = BEARER.exec(header.trim())?.[1]
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  return token
}
