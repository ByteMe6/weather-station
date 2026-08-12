import {
  API_VERSIONS,
  DEFAULT_SEND_INTERVAL_MS,
  DEVICE_ID_HEADER,
  LATEST_API_VERSION,
  readingsIngestPath,
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

describe('API version registry', () => {
  // Firmware pins the full ingest URL at flash time, so a patch/minor segment
  // in the path would strand the deployed fleet. Semver belongs in the OpenAPI
  // `info.version`, never here.
  it('should keep path versions major-only — no semver in the URL', () => {
    for (const version of API_VERSIONS) {
      expect(version).toMatch(/^v\d+$/)
    }
  })

  it('should list at least one version, with no duplicates', () => {
    expect(API_VERSIONS.length).toBeGreaterThan(0)
    expect(new Set(API_VERSIONS).size).toBe(API_VERSIONS.length)
  })

  it('should point LATEST_API_VERSION at a version that is actually served', () => {
    expect(API_VERSIONS).toContain(LATEST_API_VERSION)
  })

  it('should build a versioned ingest path for every served version', () => {
    for (const version of API_VERSIONS) {
      expect(readingsIngestPath(version)).toBe(`/api/${version}/readings`)
    }
  })
})
