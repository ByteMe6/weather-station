/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import type { Reading } from '@ws/shared'
import type { ReactNode } from 'react'

jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}))
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}))

const state = {
  isLoading: false,
  deviceId: 'WS-7F3A' as string | null,
  devices: [] as MyDevice[],
  setDeviceId: jest.fn(),
  latest: null as Reading | null,
  points: [] as HistoryPoint[],
  status: 'live' as RealtimeStatus,
  now: new Date('2026-08-15T12:37:00Z'),
  error: null as unknown,
  range: '24h' as HistoryRange,
  setRange: jest.fn(),
  chartPoints: [] as HistoryPoint[],
  chartLoading: false,
  chartError: false,
}
jest.mock('@/components/dashboard/useDashboardData', () => ({
  useDashboardData: () => state,
}))
// The export dialog pulls in the server action (Clerk backend ESM) — not under test here.
jest.mock('@/actions/readings.action', () => ({
  exportReadingsChunkAction: jest.fn(),
}))

import { ConditionsStrip } from '@/components/dashboard/ConditionsStrip'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ParameterCard } from '@/components/dashboard/ParameterCard'
import { ParameterCardGrid } from '@/components/dashboard/ParameterCardGrid'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { parameterMeta } from '@/lib/parameters'
import type { MyDevice } from '@/services/devices/devices.service'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'

const latest: Reading = {
  id: 1,
  deviceId: 'WS-7F3A',
  timestamp: '2026-08-15T12:35:00Z',
  temperature: 21.4,
  humidity: 58,
  pressure: 1013.2,
  windSpeed: null,
  windDirection: null,
  precipitation: null,
}

describe('dashboard', () => {
  it('shows the skeleton while loading', () => {
    state.isLoading = true
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-skeleton')).toBeInTheDocument()
    state.isLoading = false
  })

  it('shows the no-device state when the user has no station', () => {
    state.deviceId = null
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-no-device')).toHaveTextContent(
      'No station yet',
    )
    expect(screen.getByTestId('dash-no-device-register')).toHaveAttribute(
      'href',
      '/devices/register',
    )
    state.deviceId = 'WS-7F3A'
  })

  it('shows waiting state when a device exists but has no readings', () => {
    state.latest = null
    render(<DashboardView testId="dash" />)
    expect(screen.getByTestId('dash-waiting')).toHaveTextContent(
      'Waiting for the first reading',
    )
  })

  it('renders the conditions strip with values, freshness and not-fitted cards', () => {
    render(
      <ConditionsStrip
        testId="strip"
        latest={latest}
        points={[]}
        status="live"
        now={new Date('2026-08-15T12:37:00Z')}
      />,
    )
    expect(screen.getByTestId('strip-hero')).toHaveTextContent('21.4')
    expect(screen.getByTestId('strip-eyebrow')).toHaveTextContent('2 min ago')
    render(
      <ParameterCard
        testId="card"
        meta={parameterMeta('precipitation')}
        value={null}
        points={[]}
        trend={null}
      />,
    )
    expect(screen.getByTestId('card')).toHaveAttribute('data-fitted', 'false')
    expect(screen.getByTestId('card')).toHaveTextContent('Sensor not fitted')
  })

  it('renders wind and rain cards as fitted when the latest reading has values', () => {
    const withWind: Reading = {
      ...latest,
      windSpeed: 12,
      windDirection: 315,
      precipitation: 0,
    }
    render(
      <ParameterCardGrid
        testId="grid"
        latest={withWind}
        points={[]}
        now={new Date('2026-08-15T12:37:00Z')}
      />,
    )
    expect(screen.getByTestId('grid-windSpeed')).toHaveAttribute(
      'data-fitted',
      'true',
    )
    expect(screen.getByTestId('grid-windDirection')).toHaveTextContent('NW')
    expect(screen.getByTestId('grid-precipitation')).toHaveAttribute(
      'data-fitted',
      'true',
    )
  })
})
