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

/** API version prefix for the device-facing HTTP surface (PRD B1). */
export const API_VERSION = 'v1'

/**
 * Fully-qualified ingest path. Single source of truth for the route handler,
 * the OpenAPI `servers` block, and the firmware upload URL (MRP-15) — keep
 * firmware config in sync when this changes.
 */
export const READINGS_INGEST_PATH = `/api/${API_VERSION}/readings`

/**
 * Plausible physical ranges for sensor values (PRD B1 basic validation).
 * Inclusive bounds; readings outside these are rejected with HTTP 400.
 */
export const SENSOR_BOUNDS = {
  temperature: { min: -90, max: 60 }, // °C
  humidity: { min: 0, max: 100 }, // % relative humidity
  pressure: { min: 300, max: 1100 }, // hPa (BME280 operating range)
  windSpeed: { min: 0, max: 120 }, // km/h
  windDirection: { min: 0, max: 360 }, // degrees
  precipitation: { min: 0, max: 500 }, // mm
} as const
