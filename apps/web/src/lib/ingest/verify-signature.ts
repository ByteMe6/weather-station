import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify an HMAC-SHA256 signature over `${timestamp}.${rawBody}` (MRP-12
 * contract). The key is the device secret used as-is — the 64-char hex string
 * as UTF-8 text, NOT decoded to bytes — matching the firmware signer (MRP-15).
 * The provided signature is lowercase hex.
 *
 * Comparison is constant-time. Returns false — never throws — on a malformed
 * or wrong-length signature so the caller can treat every failure as one
 * generic 401. Validate the canonical encoding before decoding because
 * `Buffer.from(_, 'hex')` silently truncates at the first invalid character.
 */
export const verifySignature = (params: {
  secret: string
  timestamp: string
  rawBody: string
  signature: string
}): boolean => {
  if (!/^[0-9a-f]{64}$/.test(params.signature)) return false

  const expected = createHmac('sha256', params.secret)
    .update(`${params.timestamp}.${params.rawBody}`)
    .digest()
  const provided = Buffer.from(params.signature, 'hex')

  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}
