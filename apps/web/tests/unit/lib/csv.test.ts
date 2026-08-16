import { CSV_HEADER, exportFilename, readingToCsvLine } from '@/lib/csv'

describe('csv', () => {
  it('serialises a reading with nulls as empty fields', () => {
    expect(
      readingToCsvLine({
        id: 1,
        deviceId: 'WS-1',
        timestamp: '2026-08-15T12:35:00.000Z',
        temperature: 21.4,
        humidity: null,
        pressure: 1013.2,
        windSpeed: 12,
        windDirection: 315,
        precipitation: null,
      }),
    ).toBe('2026-08-15T12:35:00.000Z,WS-1,21.4,,1013.2,12,315,')
    expect(CSV_HEADER.split(',')).toHaveLength(8)
  })
  it('builds the filename from device and dates', () => {
    expect(
      exportFilename(
        'WS-7F3A',
        '2026-06-01T00:00:00.000Z',
        '2026-06-30T23:59:59.000Z',
      ),
    ).toBe('weather_WS-7F3A_2026-06-01_2026-06-30.csv')
  })
})
