import { toApiReading, toApiStation, withProfile } from '@/lib/api/stations'
import type { StationRow } from '@/services/devices/devices.service'

jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: jest.fn() }))

const row: StationRow = {
  deviceId: 'ws-abc123',
  role: 'editor',
  addedAt: '2026-08-16T10:00:00.000Z',
  device: {
    status: 'registered',
    createdAt: '2026-07-10T09:00:00.000Z',
    label: null,
    address: 'Main St 1',
    latitude: 50.45,
    longitude: 30.52,
  },
}

describe('station DTOs', () => {
  it('names an unlabelled station by its id and nests the location', () => {
    expect(toApiStation(row, '2026-10-01T08:55:00+00:00')).toEqual({
      id: 'ws-abc123',
      name: 'ws-abc123',
      label: null,
      address: 'Main St 1',
      location: { latitude: 50.45, longitude: 30.52 },
      role: 'editor',
      status: 'registered',
      addedAt: '2026-08-16T10:00:00.000Z',
      createdAt: '2026-07-10T09:00:00.000Z',
      lastReadingAt: '2026-10-01T08:55:00+00:00',
    })
  })

  it('reports no location unless both coordinates are set', () => {
    const half = { ...row, device: { ...row.device, longitude: null } }
    expect(toApiStation(half, null).location).toBeNull()
  })

  it('applies a stored profile over the row', () => {
    const updated = withProfile(row, {
      label: 'Roof',
      address: null,
      latitude: null,
      longitude: null,
    })
    expect(toApiStation(updated, null)).toMatchObject({
      name: 'Roof',
      address: null,
      location: null,
    })
  })

  it('drops internal fields from a reading', () => {
    expect(
      toApiReading({
        id: 7,
        deviceId: 'ws-abc123',
        timestamp: 't',
        temperature: 1,
        humidity: null,
        pressure: 1000,
        windSpeed: null,
        windDirection: null,
        precipitation: null,
      }),
    ).toEqual({
      timestamp: 't',
      temperature: 1,
      humidity: null,
      pressure: 1000,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    })
  })
})
