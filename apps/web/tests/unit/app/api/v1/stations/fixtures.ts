import type { DeviceRole } from '@ws/shared'

import type { StationRow } from '@/services/devices/devices.service'

export const TOKEN = `wsk_live_${'a'.repeat(43)}`
export const RESET = new Date(Date.now() + 30_000).toISOString()

export const stationRow = (
  role: DeviceRole = 'owner',
  device: Partial<StationRow['device']> = {},
): StationRow => ({
  deviceId: 'ws-abc123',
  role,
  addedAt: '2026-08-16T10:00:00.000Z',
  device: {
    status: 'registered',
    createdAt: '2026-07-10T09:00:00.000Z',
    label: 'Balcony',
    address: 'Main St 1',
    latitude: 50.45,
    longitude: 30.52,
    ...device,
  },
})

export const apiRequest = (
  path: string,
  init: { method?: string; body?: unknown; rawBody?: string } = {},
): Request =>
  new Request(`http://localhost/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body:
      init.rawBody ??
      (init.body === undefined ? undefined : JSON.stringify(init.body)),
  })

export const params = <P extends Record<string, string>>(p: P) => ({
  params: Promise.resolve(p),
})
