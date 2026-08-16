'use client'

import type { Reading } from '@ws/shared'
import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { ChartPanel } from './ChartPanel'

import { fadeUp, stagger } from '@/components/motion/variants'
import type { HistoryPoint, HistoryRange } from '@/lib/chart'
import { PARAMETERS } from '@/lib/parameters'

/** One chart panel per parameter the device reports (null in the latest reading = not fitted). Wind direction is not charted. */
export const ChartSection = ({
  latest,
  points,
  range,
  now,
  testId,
}: {
  latest: Reading
  points: HistoryPoint[]
  range: HistoryRange
  now: Date
  testId: string
}): ReactElement => {
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
      {metas.map((meta) => (
        <motion.div key={meta.key} variants={fadeUp}>
          <ChartPanel
            testId={`${testId}-${meta.key}`}
            meta={meta}
            points={points}
            range={range}
            now={now}
          />
        </motion.div>
      ))}
    </motion.section>
  )
}
