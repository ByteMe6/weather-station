import { createHmac } from 'node:crypto'

import { verifySignature } from '@/lib/ingest/verify-signature'

const SECRET = 'a'.repeat(64)
const TIMESTAMP = '1721563200000'
const BODY = '{"temperature":21.4}'

const sign = (secret: string, timestamp: string, rawBody: string) =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    const signature = sign(SECRET, TIMESTAMP, BODY)
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: BODY,
        signature,
      }),
    ).toBe(true)
  })

  it('rejects a tampered body', () => {
    const signature = sign(SECRET, TIMESTAMP, BODY)
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: '{"temperature":99}',
        signature,
      }),
    ).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const signature = sign('b'.repeat(64), TIMESTAMP, BODY)
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: BODY,
        signature,
      }),
    ).toBe(false)
  })

  it('rejects malformed (non-hex) signatures without throwing', () => {
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: BODY,
        signature: 'zz',
      }),
    ).toBe(false)
  })

  it('rejects a wrong-length signature', () => {
    expect(
      verifySignature({
        secret: SECRET,
        timestamp: TIMESTAMP,
        rawBody: BODY,
        signature: 'ab',
      }),
    ).toBe(false)
  })
})
