'use client'

import { useUser } from '@clerk/nextjs'
import { AnimatePresence } from 'motion/react'
import Link from 'next/link'
import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import type { ScheduleDraft } from './ScheduleDialog'
import { ScheduleDialog } from './ScheduleDialog'
import { ScheduleRow } from './ScheduleRow'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { localTimeZone } from '@/lib/schedule'
import {
  useCreateScheduleMutation,
  useDeleteScheduleMutation,
  useSchedulesQuery,
  useUpdateScheduleMutation,
} from '@/services/schedules/schedules.queries'
import type { Schedule } from '@/services/schedules/schedules.service'
import { useCurrentUserQuery } from '@/services/users/users.queries'

const WEEKDAYS_DEFAULT = [1, 2, 3, 4, 5]

export const AlertsView = ({ testId }: { testId: string }): ReactElement => {
  const { isLoaded } = useUser()
  const me = useCurrentUserQuery()
  const schedules = useSchedulesQuery()
  const create = useCreateScheduleMutation()
  const update = useUpdateScheduleMutation()
  const remove = useDeleteScheduleMutation()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Schedule | null>(null)
  const [deleting, setDeleting] = useState<Schedule | null>(null)

  const openAdd = useCallback(() => setAdding(true), [])
  const closeAdd = useCallback((o: boolean) => setAdding(o), [])
  const closeEdit = useCallback((o: boolean) => {
    if (!o) setEditing(null)
  }, [])
  const closeDelete = useCallback((o: boolean) => {
    if (!o) setDeleting(null)
  }, [])
  const cancelDelete = useCallback(() => setDeleting(null), [])

  const userId = me.data?.id ?? null
  const onCreate = useCallback(
    async (draft: ScheduleDraft) => {
      if (!userId) return
      try {
        await create.mutateAsync({ userId, ...draft })
        toast({ title: 'Alert added', tone: 'success' })
        setAdding(false)
      } catch {
        toast({ title: "Couldn't add the alert", tone: 'danger' })
      }
    },
    [create, userId, toast],
  )
  const onUpdate = useCallback(
    async (draft: ScheduleDraft) => {
      if (!editing) return
      try {
        await update.mutateAsync({ id: editing.id, ...draft })
        toast({ title: 'Alert updated', tone: 'success' })
        setEditing(null)
      } catch {
        toast({ title: "Couldn't update the alert", tone: 'danger' })
      }
    },
    [editing, update, toast],
  )
  const onDelete = useCallback(async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync({ id: deleting.id })
      toast({ title: 'Alert deleted', tone: 'success' })
    } catch {
      toast({ title: "Couldn't delete the alert", tone: 'danger' })
    }
    setDeleting(null)
  }, [deleting, remove, toast])

  if (!isLoaded || me.isLoading)
    return <Skeleton testId={`${testId}-skeleton`} className="h-40" />

  if (!me.data?.telegramId) {
    return (
      <EmptyState
        testId={`${testId}-link-telegram`}
        title="Link Telegram to manage alerts here"
        description="Alerts are delivered by the Telegram bot. Once your account is linked, you can add and edit the schedule from this page."
        action={
          <Link
            data-testid={`${testId}-link-telegram-action`}
            href="/settings"
            className="rounded-control bg-ink text-paper inline-flex h-10 items-center px-4 text-sm font-semibold"
          >
            Go to settings
          </Link>
        }
      />
    )
  }

  const list = schedules.data ?? []
  return (
    <div data-testid={testId} className="flex flex-col gap-4">
      <Card testId={`${testId}-card`}>
        <CardHeader testId={`${testId}-card-header`}>
          <CardTitle testId={`${testId}-card-title`}>
            Scheduled alerts
          </CardTitle>
          <span className="flex-1" />
          <Button testId={`${testId}-add`} size="sm" onClick={openAdd}>
            Add alert
          </Button>
        </CardHeader>
        <CardBody testId={`${testId}-card-body`}>
          <p className="text-slate mb-2 text-[13px]">
            Alerts arrive in Telegram at these local times. The bot&apos;s alert
            menu edits the same list.
          </p>
          {schedules.isLoading ? (
            <Skeleton testId={`${testId}-list-skeleton`} className="h-20" />
          ) : list.length === 0 ? (
            <p
              data-testid={`${testId}-empty`}
              className="text-slate py-6 text-center text-sm"
            >
              No alerts yet — add one.
            </p>
          ) : (
            <ul className="flex flex-col">
              <AnimatePresence initial={false}>
                {list.map((s) => (
                  <ScheduleRow
                    key={s.id}
                    testId={`${testId}-row-${s.id}`}
                    schedule={s}
                    onEdit={setEditing}
                    onDelete={setDeleting}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardBody>
      </Card>
      {adding ? (
        <ScheduleDialog
          testId={`${testId}-add-dialog`}
          open={adding}
          onOpenChange={closeAdd}
          initial={{
            time: '07:30',
            timezone: localTimeZone(),
            days: WEEKDAYS_DEFAULT,
          }}
          onSubmit={onCreate}
          pending={create.isPending}
        />
      ) : null}
      {editing ? (
        <ScheduleDialog
          testId={`${testId}-edit-dialog`}
          open
          onOpenChange={closeEdit}
          initial={{
            time: editing.time,
            timezone: editing.timezone,
            days: editing.days,
          }}
          onSubmit={onUpdate}
          pending={update.isPending}
          title="Edit alert"
        />
      ) : null}
      <Dialog
        testId={`${testId}-delete-dialog`}
        open={deleting !== null}
        onOpenChange={closeDelete}
        title="Delete this alert?"
        description={
          deleting ? `${deleting.time} · ${deleting.timezone}` : undefined
        }
      >
        <div className="flex justify-end gap-2">
          <Button
            testId={`${testId}-delete-cancel`}
            variant="ghost"
            onClick={cancelDelete}
          >
            Cancel
          </Button>
          <Button
            testId={`${testId}-delete-confirm`}
            variant="danger"
            onClick={onDelete}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
