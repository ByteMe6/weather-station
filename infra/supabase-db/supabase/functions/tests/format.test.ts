import { assertEquals, assertMatch, assertStringIncludes } from '@std/assert'

import {
  compassPoint,
  formatAge,
  formatAlertMessage,
  formatCurrentMessage,
  formatDeviceBlock,
} from '../_shared/format.ts'
import type { DeviceReading } from '../_shared/readings.ts'

const NOW = new Date('2026-08-23T12:08:00Z')
const full: DeviceReading = {
  deviceId: 'ws-a1b2c3',
  label: 'Backyard',
  reading: {
    timestamp: '2026-08-23T12:05:00Z',
    temperature: 21.4,
    humidity: 55,
    pressure: 1013,
    windSpeed: 3.2,
    windDirection: 45,
    precipitation: 0.5,
  },
}

Deno.test('compassPoint maps degrees to 8 points', () => {
  assertEquals(compassPoint(0), 'N')
  assertEquals(compassPoint(45), 'NE')
  assertEquals(compassPoint(350), 'N')
  assertEquals(compassPoint(180), 'S')
})

Deno.test('formatAge buckets', () => {
  assertEquals(formatAge(new Date('2026-08-23T12:07:30Z'), NOW), 'just now')
  assertEquals(formatAge(new Date('2026-08-23T12:05:00Z'), NOW), '3 min ago')
  assertEquals(formatAge(new Date('2026-08-23T10:05:00Z'), NOW), '2 h ago')
})

Deno.test('device block shows all six T6 parameters', () => {
  const block = formatDeviceBlock(full, 'UTC', NOW)
  assertStringIncludes(block, 'Backyard')
  assertStringIncludes(block, '21.4 °C')
  assertStringIncludes(block, '55 %')
  assertStringIncludes(block, '1013 hPa')
  assertStringIncludes(block, '3.2 m/s NE')
  assertStringIncludes(block, '0.5 mm')
  assertMatch(block, /as of 12:05 UTC \(3 min ago\)/)
})

Deno.test(
  'missing sensors read as unavailable, missing reading as no data',
  () => {
    const sparse: DeviceReading = {
      ...full,
      reading: {
        ...full.reading!,
        windSpeed: null,
        windDirection: null,
        precipitation: null,
      },
    }
    const block = formatDeviceBlock(sparse, 'UTC', NOW)
    assertStringIncludes(block, 'Wind: unavailable')
    assertStringIncludes(block, 'Precipitation: unavailable')
    const empty: DeviceReading = { ...full, reading: null }
    assertStringIncludes(formatDeviceBlock(empty, 'UTC', NOW), 'no data yet')
  },
)

Deno.test('current and alert messages compose blocks', () => {
  assertStringIncludes(formatCurrentMessage([full], 'UTC', NOW), 'ws-a1b2c3')
  const alert = formatAlertMessage(
    [full],
    { time: '07:30', timezone: 'Europe/Kyiv' },
    NOW,
  )
  assertMatch(alert, /^⏰ Weather alert — 07:30 Europe\/Kyiv/)
})
