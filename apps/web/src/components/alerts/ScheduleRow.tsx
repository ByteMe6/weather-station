'use client'

import { motion } from 'motion/react'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { DayPills } from './DayPills'

import { springs } from '@/components/motion/variants'
import { Button } from '@/components/ui/Button'
import type { Schedule } from '@/services/schedules/schedules.service'

export const ScheduleRow = ({
  schedule,
  onEdit,
  onDelete,
  testId,
}: {
  schedule: Schedule
  onEdit: (s: Schedule) => void
  onDelete: (s: Schedule) => void
  testId: string
}): ReactElement => {
  const edit = useCallback(() => onEdit(schedule), [schedule, onEdit])
  const del = useCallback(() => onDelete(schedule), [schedule, onDelete])
  return (
    <motion.li
      data-testid={testId}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={springs.default}
      className="border-line flex flex-wrap items-center gap-4 border-b py-3 last:border-b-0"
    >
      <span className="readout text-[26px] leading-none">{schedule.time}</span>
      <DayPills testId={`${testId}-day`} days={schedule.days} />
      <span className="text-slate font-mono text-xs">{schedule.timezone}</span>
      <span className="flex-1" />
      <Button
        testId={`${testId}-edit`}
        variant="ghost"
        size="sm"
        onClick={edit}
      >
        Edit
      </Button>
      <Button
        testId={`${testId}-delete`}
        variant="ghost"
        size="sm"
        onClick={del}
      >
        Delete
      </Button>
    </motion.li>
  )
}
