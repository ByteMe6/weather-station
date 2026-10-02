/**
 * Domain types shared between the web app (API routes, dashboard) and the
 * Telegram bot. Mirrors the data model in docs/04-prd.md (D1–D5).
 */

export type DeviceStatus = 'unregistered' | 'registered'

export type DeviceRole = 'owner' | 'editor' | 'viewer'

/**
 * Sensor values in one reading. The target sensor is a BME280 — temperature,
 * humidity and pressure (MRP-47). Wind and rain sensors land post-MVP, so
 * their fields are nullable (docs/03-scope-mvp.md).
 *
 * `humidity` is nullable and stays that way. The firmware detects its sensor
 * from the Bosch chip ID and drives either part, because the BME280 is
 * pin-compatible with the BMP280 prototype that preceded it; a BMP280 has no
 * humidity element and reports null. `readings.humidity` is nullable in
 * Postgres for the same reason (migration 20260804093001), so tightening the
 * type here would lie both about rows already in the table and about any unit
 * still carrying the older part. It can tighten once no BMP280 unit is in the
 * field and the historical nulls are gone.
 */
export interface SensorValues {
  /** °C */
  temperature: number
  /** % relative humidity — null on a BMP280 unit (see above) */
  humidity: number | null
  /** hPa */
  pressure: number
  /** km/h */
  windSpeed: number | null
  /** 0–360° */
  windDirection: number | null
  /** mm */
  precipitation: number | null
}

/**
 * Body the firmware POSTs to /api/readings (PRD F6). The HMAC-SHA256
 * signature covers this serialized body plus the timestamp; header names
 * live in ../constants.
 */
export interface ReadingPayload extends SensorValues {
  /** ISO-8601 UTC, NTP-sourced on the device */
  timestamp: string
}

export interface Device {
  deviceId: string
  status: DeviceStatus
  createdAt: string
}

export interface DeviceUser {
  deviceId: string
  userId: string
  role: DeviceRole
  addedAt: string
}

export interface Reading extends SensorValues {
  id: number
  deviceId: string
  timestamp: string
}

/** Scheduled Telegram alert slot (PRD D4). */
export interface AlertSchedule {
  id: number
  userId: string
  /** HH:MM in `timezone` */
  time: string
  /** IANA zone the time is expressed in, e.g. 'Europe/Kyiv' */
  timezone: string
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday */
  days: number[]
  createdAt: string
}

/** Public station API (/api/v1/stations) — response shapes scripts receive. */
export interface ApiStationLocation {
  latitude: number
  longitude: number
}

export interface ApiStation {
  /** The device id, e.g. `ws-abc123def456`. */
  id: string
  /** `label ?? id` — what the UI shows. */
  name: string
  label: string | null
  address: string | null
  location: ApiStationLocation | null
  /** The key owner's role on this station. */
  role: DeviceRole
  status: DeviceStatus
  addedAt: string
  createdAt: string
  lastReadingAt: string | null
}

export interface ApiReading extends SensorValues {
  timestamp: string
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    fieldErrors?: Record<string, string>
  }
}
