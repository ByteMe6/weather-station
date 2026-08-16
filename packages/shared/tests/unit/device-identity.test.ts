import { generateDeviceId, generateDeviceSecret } from '../../src'

describe('device identity', () => {
  it('mints ids as ws- plus 12 lowercase hex characters', () => {
    const id = generateDeviceId()
    expect(id).toMatch(/^ws-[0-9a-f]{12}$/)
    expect(generateDeviceId()).not.toBe(id)
  })

  it('mints 256-bit secrets as 64 lowercase hex characters', () => {
    const secret = generateDeviceSecret()
    expect(secret).toMatch(/^[0-9a-f]{64}$/)
    expect(generateDeviceSecret()).not.toBe(secret)
  })
})
