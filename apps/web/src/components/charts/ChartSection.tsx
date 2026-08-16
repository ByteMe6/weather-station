'use client'

import type { Reading } from '@ws/shared'
import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { ChartPanel } from './ChartPanel'
import { RangeSelector } from './RangeSelector'

import { fadeUp, stagger } from '@/components/motion/variants'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { PARAMETERS } from '@/lib/parameters'

interface ChartSectionProps {
  latest: Reading
  points: HistoryPoint[]
  range: HistoryRange
  onRangeChange: (r: HistoryRange) => void
  /** True while a newly selected range is loading — panels show skeletons, never a blank chart. */
  loading?: boolean
  error?: boolean
  now: Date
  testId: string
}

/** One chart panel per parameter the device reports (null in the latest reading = not fitted). Wind direction is not charted. */
export const ChartSection = ({
  latest,
  points,
  range,
  onRangeChange,
  loading = false,
  error = false,
  now,
  testId,
}: ChartSectionProps): ReactElement => {
  const metas = useMemo(
    () =>
      PARAMETERS.filter(
        (m) => m.key !== 'windDirection' && latest[m.key] !== null,
      ),
    [latest],
  )
  return (
    <motion.section
      data-testid={testId}
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="flex flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">History</h2>
        <span className="flex-1" />
        <RangeSelector
          testId={`${testId}-range`}
          value={range}
          onChange={onRangeChange}
        />
      </div>
      {error ? (
        <EmptyState
          testId={`${testId}-error`}
          title="Couldn't load this range"
          description="Try another range or reload the page."
        />
      ) : (
        metas.map((meta) =>
          loading ? (
            <Skeleton
              key={meta.key}
              testId={`${testId}-${meta.key}-skeleton`}
              className="h-64"
            />
          ) : (
            <motion.div key={meta.key} variants={fadeUp}>
              <ChartPanel
                testId={`${testId}-${meta.key}`}
                meta={meta}
                points={points}
                range={range}
                now={now}
              />
            </motion.div>
          ),
        )
      )}
    </motion.section>
  )
}
