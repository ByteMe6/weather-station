/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { ParameterChart } from '@/components/charts/ParameterChart'
import { parameterMeta } from '@/lib/parameters'

describe('ParameterChart', () => {
  it('renders an SVG line chart at a fixed size (jsdom has no layout)', () => {
    const now = Date.now()
    const points = Array.from({ length: 12 }, (_, i) => ({
      t: now - (11 - i) * 300_000,
      temperature: 20 + i / 10,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    }))
    render(
      <ParameterChart
        testId="chart"
        meta={parameterMeta('temperature')}
        points={points}
        range="24h"
        now={new Date(now)}
        width={600}
        height={200}
      />,
    )
    expect(screen.getByTestId('chart')).toBeInTheDocument()
    expect(screen.getByTestId('chart').querySelector('svg')).not.toBeNull()
  })

  it('renders precipitation as bars', () => {
    const now = Date.now()
    const points = Array.from({ length: 6 }, (_, i) => ({
      t: now - (5 - i) * 300_000,
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      precipitation: i % 2,
    }))
    render(
      <ParameterChart
        testId="rain"
        meta={parameterMeta('precipitation')}
        points={points}
        range="24h"
        now={new Date(now)}
        width={600}
        height={200}
      />,
    )
    expect(
      screen.getByTestId('rain').querySelectorAll('.recharts-bar-rectangle')
        .length,
    ).toBeGreaterThan(0)
  })
})
