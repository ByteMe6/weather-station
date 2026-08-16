import type { Reading } from '@ws/shared'

import {
  bucketMinutesFor,
  bucketedToPoints,
  lastN,
  rangeWindow,
  toHistoryPoints,
  trendFor,
  withGaps,
} from '@/lib/chart'

const r = (iso: string, temperature: number): Reading => ({
  id: 1,
  deviceId: 'WS-1',
  timestamp: iso,
  temperature,
  humidity: 50,
  pressure: 1013,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
})

describe('chart', () => {
  it('rangeWindow spans the range ending now', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    expect(rangeWindow('24h', now)).toEqual({
      from: '2026-08-14T12:00:00.000Z',
      to: '2026-08-15T12:00:00.000Z',
    })
  })
  it('withGaps inserts a null point after a gap larger than the threshold', () => {
    const pts = toHistoryPoints([
      r('2026-08-15T10:00:00Z', 20),
      r('2026-08-15T10:05:00Z', 21),
      r('2026-08-15T11:00:00Z', 22),
    ])
    const out = withGaps(pts, 10 * 60_000)
    expect(out).toHaveLength(4)
    expect(out[2]).toMatchObject({ temperature: null })
    expect(out[2]?.t).toBeGreaterThan(pts[1]!.t)
    expect(out[2]?.t).toBeLessThan(pts[2]!.t)
  })
  it('trendFor compares now against ~window ago', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    const pts = toHistoryPoints([
      r('2026-08-15T09:00:00Z', 20.8),
      r('2026-08-15T11:55:00Z', 21.4),
    ])
    expect(trendFor(pts, 'temperature', 3 * 3_600_000, now)).toEqual({
      delta: 0.6,
      direction: 'up',
    })
    expect(trendFor(pts, 'temperature', 3 * 3_600_000, now, 1)).toEqual({
      delta: 0.6,
      direction: 'flat',
    })
    expect(trendFor(pts.slice(1), 'temperature', 3 * 3_600_000, now)).toBeNull()
  })
  it('lastN keeps points within the window', () => {
    const now = new Date('2026-08-15T12:00:00Z')
    const pts = toHistoryPoints([
      r('2026-08-15T08:00:00Z', 1),
      r('2026-08-15T11:00:00Z', 2),
    ])
    expect(lastN(pts, 3 * 3_600_000, now)).toHaveLength(1)
  })
  it('bucketMinutesFor maps ranges', () => {
    expect(bucketMinutesFor('24h')).toBeNull()
    expect(bucketMinutesFor('7d')).toBe(60)
    expect(bucketMinutesFor('30d')).toBe(360)
  })
  it('bucketedToPoints maps averages and bands', () => {
    const pts = bucketedToPoints([
      {
        bucket: '2026-08-01T00:00:00Z',
        avgTemperature: 11,
        minTemperature: 10,
        maxTemperature: 12,
        avgHumidity: 51,
        minHumidity: 50,
        maxHumidity: 52,
        avgPressure: 1000.5,
        minPressure: 1000,
        maxPressure: 1001,
        avgWindSpeed: null,
        maxWindSpeed: null,
        totalPrecipitation: null,
        sampleCount: 2,
      },
    ])
    expect(pts[0]).toMatchObject({
      temperature: 11,
      temperatureMin: 10,
      temperatureMax: 12,
      humidity: 51,
      pressure: 1000.5,
      windSpeed: null,
      precipitation: null,
    })
  })
})
