/**
 * Domain types shared between the web app (API routes, dashboard) and the
 * Telegram bot. Mirrors the data model in docs/04-prd.md (D1–D5).
 */

export type DeviceStatus = 'unregistered' | 'registered'

export type DeviceRole = 'owner' | 'editor' | 'viewer'

/**
 * Sensor values in one reading. Shipped hardware is a BMP280 (temperature,
 * pressure only), so humidity is nullable until a sensor that can measure it
 * is fitted; wind and rain sensors land post-MVP, so their fields are
 * nullable too (docs/03-scope-mvp.md).
 */
export interface SensorValues {
  /** °C */
  temperature: number
  /** % relative humidity — null on devices with no humidity sensor (BMP280) */
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
  /** HH:MM in the user's timezone */
  time: string
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday */
  days: number[]
  createdAt: string
}
