'use client'

import type { Reading } from '@ws/shared'
import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { ParameterCard } from './ParameterCard'

import { fadeUp, stagger } from '@/components/motion/variants'
import type { HistoryPoint } from '@/lib/chart'
import { lastN, trendFor } from '@/lib/chart'
import { PARAMETERS } from '@/lib/parameters'

const THREE_HOURS = 3 * 3_600_000

export const ParameterCardGrid = ({
  latest,
  points,
  now,
  testId,
}: {
  latest: Reading
  points: HistoryPoint[]
  now: Date
  testId: string
}): ReactElement => {
  const recent = useMemo(() => lastN(points, THREE_HOURS, now), [points, now])
  const cards = useMemo(
    () =>
      PARAMETERS.map((meta) => ({
        meta,
        value: latest[meta.key],
        trend: trendFor(recent, meta.key, THREE_HOURS, now),
      })),
    [latest, recent, now],
  )
  return (
    <motion.section
      data-testid={testId}
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6"
    >
      {cards.map(({ meta, value, trend }) => (
        <motion.div key={meta.key} variants={fadeUp} layout>
          <ParameterCard
            testId={`${testId}-${meta.key}`}
            meta={meta}
            value={value}
            points={recent}
            trend={trend}
          />
        </motion.div>
      ))}
    </motion.section>
  )
}
