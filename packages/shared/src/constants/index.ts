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

/**
 * Every path version the backend currently serves, oldest first (PRD B1).
 *
 * Path versions are **major-only** — `v1`, `v2`, never `v1.0.1`. Each device
 * holds its own full ingest URL (NVS, falling back to the flash-time `API_URL`
 * build flag), so a version segment that moved on a patch release would cut
 * every deployed device off until it was individually repointed — by reflashing
 * or by hand through its LAN setup portal. There is no fleet-wide URL push.
 * Backwards-compatible changes are published through the OpenAPI `info.version`
 * semver instead (see `API_VERSION_META` in apps/web).
 */
export const API_VERSIONS = ['v1'] as const

export type ApiVersion = (typeof API_VERSIONS)[number]

/**
 * The version new clients should target — not necessarily the newest one that
 * exists. A version can be served and documented while still being a preview,
 * so this stays pinned to the contract devices are actually expected to use.
 */
export const LATEST_API_VERSION: ApiVersion = 'v1'

/**
 * Ingest path for a given version. Callers must name the version explicitly —
 * there is deliberately no unversioned alias, because each deployed device pins
 * its own version and must never be repointed by a constant bump here.
 */
export const readingsIngestPath = (version: ApiVersion): string =>
  `/api/${version}/readings`

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

/** Web ↔ bot Telegram account linking (PRD W2b). The bot receives `/start link_<code>`. */
export const TELEGRAM_LINK_PREFIX = 'link_'
export const TELEGRAM_LINK_TTL_MS = 10 * 60_000

// Device identity lives in its own module with its own package export, so the
// provisioning CLI can import it under bare `node --experimental-strip-types`
// (which cannot follow this barrel's extensionless directory imports).
export * from './device-identity.ts'
