import { stationPins } from '@/components/map/stationPins'
import type { MyDevice } from '@/services/devices/devices.service'

const device = (
  deviceId: string,
  label: string | null,
  latitude: number | null,
  longitude: number | null,
): MyDevice => ({
  deviceId,
  role: 'owner',
  addedAt: '2026-08-01T00:00:00Z',
  device: {
    status: 'registered',
    createdAt: '2026-08-01T00:00:00Z',
    label,
    address: null,
    latitude,
    longitude,
  },
})

describe('stationPins', () => {
  it('keeps only located stations and names them like the rest of the UI', () => {
    expect(
      stationPins([
        device('ws-1', 'Backyard', 49.8397, 24.0297),
        device('ws-2', null, null, null),
        device('ws-3', null, 51.5, -0.12),
      ]),
    ).toEqual([
      {
        deviceId: 'ws-1',
        name: 'Backyard',
        latitude: 49.8397,
        longitude: 24.0297,
      },
      { deviceId: 'ws-3', name: 'ws-3', latitude: 51.5, longitude: -0.12 },
    ])
  })

  it('drops a station whose device row is not readable', () => {
    const orphan: MyDevice = {
      deviceId: 'ws-4',
      role: 'viewer',
      addedAt: '2026-08-01T00:00:00Z',
      device: null,
    }
    expect(stationPins([orphan])).toEqual([])
  })
})
