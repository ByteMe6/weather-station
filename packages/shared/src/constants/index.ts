/**
 * Contract constants for the device → backend ingest path (PRD F6/B1).
 * The firmware sends these headers; the web API route validates them.
 * Keep firmware/src config in sync when changing.
 */

export const DEVICE_ID_HEADER = 'x-device-id'
export const SIGNATURE_HEADER = 'x-signature'
export const TIMESTAMP_HEADER = 'x-timestamp'

/** Default firmware upload interval — 5 minutes (PRD OQ6). */
export const DEFAULT_SEND_INTERVAL_MS = 300_000

/**
 * Anti-replay window for HMAC timestamp validation (PRD B1): readings whose
 * timestamp differs from server time by more than this are rejected.
 */
export const REPLAY_WINDOW_MS = 300_000
