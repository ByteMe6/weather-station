'use client'

import { DEFAULT_SEND_INTERVAL_MS } from '@ws/shared'
import { motion } from 'motion/react'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useCsvExport } from './useCsvExport'

import { springs } from '@/components/motion/variants'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'

const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

export const ExportDialog = ({
  testId,
  deviceId,
  open,
  onOpenChange,
}: {
  testId: string
  deviceId: string
  open: boolean
  onOpenChange: (o: boolean) => void
}): ReactElement => {
  const { toast } = useToast()
  const { start, abort, progress } = useCsvExport()
  const [from, setFrom] = useState(() =>
    isoDay(new Date(Date.now() - 7 * 86_400_000)),
  )
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [running, setRunning] = useState(false)

  const estimate = useMemo(() => {
    const days =
      (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 + 1
    return Math.max(
      0,
      Math.round((days * 86_400_000) / DEFAULT_SEND_INTERVAL_MS),
    )
  }, [from, to])

  const onFrom = useCallback(
    (e: FormEvent<HTMLInputElement>) => setFrom(e.currentTarget.value),
    [],
  )
  const onTo = useCallback(
    (e: FormEvent<HTMLInputElement>) => setTo(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setRunning(true)
      await start({
        deviceId,
        from: `${from}T00:00:00.000Z`,
        to: `${to}T23:59:59.999Z`,
      })
      setRunning(false)
    },
    [deviceId, from, to, start],
  )

  useEffect(() => {
    if (progress.done) {
      toast({
        title: 'CSV downloaded',
        description: `${progress.rows.toLocaleString()} readings`,
        tone: 'success',
      })
      onOpenChange(false)
    }
  }, [progress.done, progress.rows, toast, onOpenChange])

  const close = useCallback(
    (o: boolean) => {
      if (!o) abort()
      onOpenChange(o)
    },
    [abort, onOpenChange],
  )
  const cancel = useCallback(() => close(false), [close])
  const pct =
    estimate > 0
      ? Math.min(100, Math.round((progress.rows / estimate) * 100))
      : 0

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={close}
      title="Export CSV"
      description="All readings in the range, one row per reading, timestamps in UTC."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field testId={`${testId}-from`} label="From" htmlFor="export-from">
            <Input
              testId={`${testId}-from-input`}
              id="export-from"
              type="date"
              value={from}
              max={to}
              onChange={onFrom}
              required
            />
          </Field>
          <Field testId={`${testId}-to`} label="To" htmlFor="export-to">
            <Input
              testId={`${testId}-to-input`}
              id="export-to"
              type="date"
              value={to}
              min={from}
              onChange={onTo}
              required
            />
          </Field>
        </div>
        <p className="text-slate text-[13px]">
          ≈ {estimate.toLocaleString()} readings
        </p>
        {running || progress.rows > 0 ? (
          <div
            data-testid={`${testId}-progress`}
            className="bg-line h-1.5 w-full overflow-hidden rounded-full"
          >
            <motion.div
              className="bg-sky h-full"
              animate={{ width: `${pct}%` }}
              transition={springs.default}
            />
          </div>
        ) : null}
        {progress.error ? (
          <p role="alert" className="text-danger text-[13px]">
            {progress.error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button testId={`${testId}-cancel`} variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button testId={`${testId}-download`} type="submit" loading={running}>
            {running ? `${progress.rows.toLocaleString()} rows…` : 'Download'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
