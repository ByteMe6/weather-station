'use client'

import type { FormEvent, ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'

import { DayPicker } from './DayPicker'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { isValidTime, localTimeZone } from '@/lib/schedule'

export interface ScheduleDraft {
  time: string
  timezone: string
  days: number[]
}

const COMMON_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Kyiv',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Australia/Sydney',
]

interface ScheduleDialogProps {
  testId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: ScheduleDraft
  onSubmit: (draft: ScheduleDraft) => Promise<void> | void
  pending: boolean
  title?: string
}

export const ScheduleDialog = ({
  testId,
  open,
  onOpenChange,
  initial,
  onSubmit,
  pending,
  title = 'Add alert',
}: ScheduleDialogProps): ReactElement => {
  const [time, setTime] = useState(initial.time)
  const [timezone, setTimezone] = useState(initial.timezone)
  const [days, setDays] = useState<number[]>(initial.days)
  const [errors, setErrors] = useState<{ time?: string; days?: string }>({})

  const zoneOptions = useMemo(() => {
    const local = localTimeZone()
    const zones = [local, ...COMMON_ZONES.filter((z) => z !== local)]
    if (!zones.includes(timezone)) zones.push(timezone)
    return zones.map((z) => ({
      value: z,
      label: z === local ? `${z} (local)` : z,
    }))
  }, [timezone])

  const onTime = useCallback(
    (e: FormEvent<HTMLInputElement>) => setTime(e.currentTarget.value),
    [],
  )

  const submit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const next: { time?: string; days?: string } = {}
      if (!isValidTime(time)) next.time = 'Enter a time like 07:30'
      if (days.length === 0) next.days = 'Pick at least one day'
      setErrors(next)
      if (next.time || next.days) return
      await onSubmit({ time, timezone, days })
    },
    [time, timezone, days, onSubmit],
  )

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="The bot sends current conditions to Telegram at this local time on the chosen days."
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-3">
          <Field
            testId={`${testId}-time`}
            label="Time"
            htmlFor="schedule-time"
            error={errors.time}
          >
            <Input
              testId={`${testId}-time-input`}
              id="schedule-time"
              type="time"
              value={time}
              onChange={onTime}
              invalid={!!errors.time}
              required
            />
          </Field>
          <Field
            testId={`${testId}-timezone`}
            label="Timezone"
            htmlFor="schedule-tz"
          >
            <Select
              testId={`${testId}-timezone-select`}
              ariaLabel="Timezone"
              value={timezone}
              onValueChange={setTimezone}
              options={zoneOptions}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-slate text-[13px] font-medium">Days</span>
          <DayPicker
            testId={`${testId}-days`}
            value={days}
            onChange={setDays}
          />
          {errors.days ? (
            <p
              data-testid={`${testId}-days-error`}
              role="alert"
              className="text-danger text-[13px]"
            >
              {errors.days}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button testId={`${testId}-save`} type="submit" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
