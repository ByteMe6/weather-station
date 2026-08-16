import type { MyDevice } from '@/services/devices/devices.service'
import { deviceDisplayName } from '@/services/devices/devices.service'

export interface StationPin {
  deviceId: string
  name: string
  latitude: number
  longitude: number
}

/**
 * Located stations only. Coordinates are both-or-neither in the database, so a
 * single null check per axis is belt and braces for rows fetched before the
 * constraint existed.
 */
export const stationPins = (devices: MyDevice[]): StationPin[] =>
  devices.flatMap((d) => {
    const { latitude, longitude } = d.device ?? {}
    if (latitude === null || latitude === undefined) return []
    if (longitude === null || longitude === undefined) return []
    return [
      {
        deviceId: d.deviceId,
        name: deviceDisplayName(d),
        latitude,
        longitude,
      },
    ]
  })
