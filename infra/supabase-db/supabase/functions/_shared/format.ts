// T6 message formatting, shared by /current and the alert dispatcher.
import type { DeviceReading } from './readings.ts'

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const

export const compassPoint = (deg: number): string =>
  POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

export const formatAge = (ts: Date, now: Date): string => {
  const mins = Math.floor((now.getTime() - ts.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.floor(mins / 60)} h ago`
}

const localHHMM = (ts: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(ts)

const line = (label: string, value: string): string => `${label}: ${value}`
const num = (v: number | null, unit: string): string | null =>
  v === null ? null : `${v} ${unit}`

export const formatDeviceBlock = (
  d: DeviceReading,
  timezone: string,
  now: Date,
): string => {
  const name = d.label ?? d.deviceId
  const heading = d.label ? `📟 ${d.label} (${d.deviceId})` : `📟 ${d.deviceId}`
  if (!d.reading) return `${heading}\nno data yet — is ${name} powered on?`
  const ts = new Date(d.reading.timestamp)
  const wind =
    d.reading.windSpeed === null
      ? 'unavailable'
      : `${d.reading.windSpeed} m/s${
          d.reading.windDirection === null
            ? ''
            : ` ${compassPoint(d.reading.windDirection)}`
        }`
  return [
    heading,
    `as of ${localHHMM(ts, timezone)} ${timezone} (${formatAge(ts, now)})`,
    line('🌡 Temperature', num(d.reading.temperature, '°C') ?? 'unavailable'),
    line('💧 Humidity', num(d.reading.humidity, '%') ?? 'unavailable'),
    line('🔽 Pressure', num(d.reading.pressure, 'hPa') ?? 'unavailable'),
    line('💨 Wind', wind),
    line('🌧 Precipitation', num(d.reading.precipitation, 'mm') ?? 'unavailable'),
  ].join('\n')
}

export const formatCurrentMessage = (
  list: DeviceReading[],
  timezone: string,
  now: Date,
): string => list.map((d) => formatDeviceBlock(d, timezone, now)).join('\n\n')

export const formatAlertMessage = (
  list: DeviceReading[],
  slot: { time: string; timezone: string },
  now: Date,
): string =>
  [
    `⏰ Weather alert — ${slot.time} ${slot.timezone}`,
    formatCurrentMessage(list, slot.timezone, now),
  ].join('\n\n')
