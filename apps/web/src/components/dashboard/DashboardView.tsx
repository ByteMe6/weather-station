'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement } from 'react'

import { ConditionsStrip } from './ConditionsStrip'
import { DashboardSkeleton } from './DashboardSkeleton'
import { NoDeviceState } from './NoDeviceState'
import { ParameterCardGrid } from './ParameterCardGrid'
import { useDashboardData } from './useDashboardData'
import { WaitingForReading } from './WaitingForReading'

import { ChartSection } from '@/components/charts/ChartSection'
import { fade } from '@/components/motion/variants'
import { EmptyState } from '@/components/ui/EmptyState'

export const DashboardView = ({ testId }: { testId: string }): ReactElement => {
  const {
    isLoading,
    deviceId,
    latest,
    points,
    status,
    now,
    error,
    range,
    setRange,
    chartPoints,
    chartLoading,
    chartError,
  } = useDashboardData()

  if (isLoading) return <DashboardSkeleton testId={`${testId}-skeleton`} />
  if (error) {
    return (
      <EmptyState
        testId={`${testId}-error`}
        title="Couldn't load your station"
        description="Check your connection and reload the page."
      />
    )
  }

  return (
    <AnimatePresence mode="wait">
      {deviceId === null ? (
        <motion.div
          key="no-device"
          variants={fade}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <NoDeviceState testId={`${testId}-no-device`} />
        </motion.div>
      ) : latest === null ? (
        <motion.div
          key="waiting"
          variants={fade}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <WaitingForReading
            testId={`${testId}-waiting`}
            deviceId={deviceId}
            status={status}
          />
        </motion.div>
      ) : (
        <motion.div
          key="data"
          variants={fade}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="flex flex-col gap-6"
        >
          <ConditionsStrip
            testId={`${testId}-strip`}
            latest={latest}
            points={points}
            status={status}
            now={now}
          />
          <ParameterCardGrid
            testId={`${testId}-cards`}
            latest={latest}
            points={points}
            now={now}
          />
          <ChartSection
            testId={`${testId}-charts`}
            latest={latest}
            points={chartPoints}
            range={range}
            onRangeChange={setRange}
            loading={chartLoading}
            error={chartError}
            now={now}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
