'use client'

import type { Reading } from '@ws/shared'
import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { TrendGlyph } from './TrendGlyph'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { NumberRoll } from '@/components/motion/NumberRoll'
import type { HistoryPoint } from '@/lib/chart'
import { lastN, trendFor } from '@/lib/chart'
import {
  bearingToCompass,
  formatRelative,
  formatTime,
  readingAgeMs,
} from '@/lib/format'
import type { RealtimeStatus } from '@/services/readings/readings.realtime'

const THREE_HOURS = 3 * 3_600_000
const STALE_AFTER_MS = 3 * DEFAULT_SEND_INTERVAL_MS

interface ConditionsStripProps {
  latest: Reading
  points: HistoryPoint[]
  status: RealtimeStatus
  now: Date
  testId: string
}

const Unit = ({ children }: { children: string }): ReactElement => (
  <small className="text-slate ml-1 text-[13px] font-medium">{children}</small>
)

export const ConditionsStrip = ({
  latest,
  points,
  status,
  now,
  testId,
}: ConditionsStripProps): ReactElement => {
  const stale = readingAgeMs(latest.timestamp, now) > STALE_AFTER_MS
  const pulseStatus = stale
    ? 'stale'
    : status === 'live'
      ? 'live'
      : status === 'reconnecting'
        ? 'reconnecting'
        : 'offline'
  const recent = useMemo(() => lastN(points, THREE_HOURS, now), [points, now])
  const trends = useMemo(
    () => ({
      humidity: trendFor(recent, 'humidity', THREE_HOURS, now),
      pressure: trendFor(recent, 'pressure', THREE_HOURS, now, 0.3),
    }),
    [recent, now],
  )
  const dayRange = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const p of points) {
      if (p.temperature === null) continue
      if (p.temperature < min) min = p.temperature
      if (p.temperature > max) max = p.temperature
    }
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null
  }, [points])

  const eyebrow = stale
    ? `No reading for ${formatRelative(latest.timestamp, now).replace(' ago', '')}`
    : `Updated ${formatTime(latest.timestamp)} · ${formatRelative(latest.timestamp, now)}`

  return (
    <section
      data-testid={testId}
      className="border-line grid grid-cols-1 items-end gap-6 border-b pb-7 md:grid-cols-[auto_1fr] md:gap-10"
    >
      <div>
        <div
          data-testid={`${testId}-eyebrow`}
          className="text-slate mb-1.5 flex items-center gap-2 font-mono text-xs"
        >
          <FreshnessPulse
            testId={`${testId}-pulse`}
            status={pulseStatus}
            pulseKey={latest.id}
          />
          <span>{eyebrow}</span>
          {status === 'reconnecting' ? (
            <span className="text-wind">· reconnecting</span>
          ) : null}
        </div>
        <div className="flex items-start gap-1.5">
          <NumberRoll
            testId={`${testId}-hero`}
            value={latest.temperature}
            decimals={1}
            className="readout-hero text-[88px] leading-[0.9] md:text-[112px]"
          />
          <span className="text-slate mt-3 text-[28px] font-medium">°C</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-9 gap-y-4 pb-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-slate text-xs">Humidity</span>
          <span className="readout text-[26px] leading-none">
            {latest.humidity === null ? '—' : latest.humidity.toFixed(0)}
            <Unit>%</Unit>
          </span>
          <TrendGlyph
            testId={`${testId}-hum-trend`}
            trend={trends.humidity}
            decimals={0}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-slate text-xs">Pressure</span>
          <span className="readout text-[26px] leading-none">
            {latest.pressure.toFixed(1)}
            <Unit>hPa</Unit>
          </span>
          <TrendGlyph
            testId={`${testId}-press-trend`}
            trend={trends.pressure}
            decimals={1}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-slate text-xs">Wind</span>
          <span className="readout text-[26px] leading-none">
            {latest.windSpeed === null ? '—' : latest.windSpeed.toFixed(0)}
            <Unit>
              {`km/h${latest.windDirection === null ? '' : ` ${bearingToCompass(latest.windDirection)}`}`}
            </Unit>
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-slate text-xs">Rain today</span>
          <span className="readout text-[26px] leading-none">
            {latest.precipitation === null
              ? '—'
              : latest.precipitation.toFixed(1)}
            <Unit>mm</Unit>
          </span>
        </div>
        {dayRange ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-slate text-xs">24 h range</span>
            <span className="readout text-[26px] leading-none">
              {dayRange.min.toFixed(1)}
              <small className="text-slate mx-1 text-[13px]">–</small>
              {dayRange.max.toFixed(1)}
              <Unit>°C</Unit>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
