import {
  DEFAULT_SEND_INTERVAL_MS,
  DEVICE_ID_HEADER,
  REPLAY_WINDOW_MS,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
} from '../../src/constants'

describe('ingest contract constants', () => {
  it('should match the 5-minute upload interval recorded in the PRD (OQ6)', () => {
    expect(DEFAULT_SEND_INTERVAL_MS).toBe(300_000)
  })

  it('should keep the replay window positive and bounded to minutes, not hours', () => {
    expect(REPLAY_WINDOW_MS).toBeGreaterThan(0)
    expect(REPLAY_WINDOW_MS).toBeLessThanOrEqual(15 * 60_000)
  })

  it('should use lowercase header names (HTTP/2 requires lowercase)', () => {
    for (const header of [
      DEVICE_ID_HEADER,
      SIGNATURE_HEADER,
      TIMESTAMP_HEADER,
    ]) {
      expect(header).toBe(header.toLowerCase())
    }
  })
})
