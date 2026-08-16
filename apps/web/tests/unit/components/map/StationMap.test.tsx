/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { StationMap } from '@/components/map/StationMap'
import type { StationPin } from '@/components/map/stationPins'

const pins: StationPin[] = [
  { deviceId: 'ws-1', name: 'Backyard', latitude: 49.8397, longitude: 24.0297 },
  { deviceId: 'ws-2', name: 'Rooftop', latitude: 51.5, longitude: -0.12 },
]

describe('StationMap', () => {
  it('renders one marker per pin, with a link to the station', () => {
    render(<StationMap testId="map" pins={pins} />)
    expect(screen.getAllByTestId('marker')).toHaveLength(2)
    expect(screen.getByText('Backyard')).toBeInTheDocument()
    expect(screen.getByTestId('map-popup-ws-2-link')).toHaveAttribute(
      'href',
      '/devices/ws-2',
    )
  })

  it('always shows the OpenStreetMap attribution (tile policy)', () => {
    render(<StationMap testId="map" pins={pins} />)
    expect(
      screen.getByTestId('tile-layer').getAttribute('data-attribution'),
    ).toContain('OpenStreetMap')
  })
})
