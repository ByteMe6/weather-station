/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

const devices: { data: MyDevice[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}))
jest.mock('@/services/devices/devices.queries', () => ({
  useMyDevicesQuery: () => devices,
}))
// next/dynamic would defer the map past the assertion; render it directly.
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    jest.requireActual<{ StationMap: unknown }>('@/components/map/StationMap')
      .StationMap,
}))

import { DevicesIndex } from '@/components/devices/DevicesIndex'
import type { MyDevice } from '@/services/devices/devices.service'

const device = (
  deviceId: string,
  latitude: number | null,
  longitude: number | null,
  role: 'owner' | 'editor' | 'viewer' = 'owner',
): MyDevice => ({
  deviceId,
  role,
  addedAt: '2026-08-01T00:00:00Z',
  device: {
    status: 'registered',
    createdAt: '2026-08-01T00:00:00Z',
    label: null,
    address: null,
    latitude,
    longitude,
  },
})

describe('DevicesIndex map card', () => {
  it('shows no map and hints owners when no station has coordinates', () => {
    devices.data = [device('ws-1', null, null)]
    render(<DevicesIndex testId="devices" />)
    expect(screen.queryByTestId('devices-map')).not.toBeInTheDocument()
    expect(screen.getByTestId('devices-hint-ws-1')).toHaveTextContent(
      'Add coordinates',
    )
  })

  it('shows the map when at least one station is located, and hints only the unlocated ones', () => {
    devices.data = [
      device('ws-1', 49.8397, 24.0297),
      device('ws-2', null, null),
    ]
    render(<DevicesIndex testId="devices" />)
    expect(screen.getByTestId('devices-map')).toBeInTheDocument()
    expect(screen.queryByTestId('devices-hint-ws-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('devices-hint-ws-2')).toBeInTheDocument()
  })

  // The hint points at "station details", which editors may now change, so it
  // follows canEditDeviceProfile rather than a hard-coded 'owner'. Named for
  // the role rather than the capability: the old name said "cannot edit" while
  // only ever rendering a viewer, so an editor slipped through it silently.
  it('does not hint a viewer, who cannot open station details', () => {
    devices.data = [device('ws-3', null, null, 'viewer')]
    render(<DevicesIndex testId="devices" />)
    expect(screen.queryByTestId('devices-hint-ws-3')).not.toBeInTheDocument()
  })

  it('hints an editor, who can open station details', () => {
    devices.data = [device('ws-4', null, null, 'editor')]
    render(<DevicesIndex testId="devices" />)
    expect(screen.getByTestId('devices-hint-ws-4')).toBeInTheDocument()
  })
})
