'use client'

import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { SecretReveal } from './SecretReveal'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import {
  useDeleteDeviceMutation,
  useRotateSecretMutation,
  useUnclaimDeviceMutation,
} from '@/services/admin/admin.queries'

export const DeviceRowActions = ({
  deviceId,
  memberCount,
  testId,
}: {
  deviceId: string
  memberCount: number
  testId: string
}): ReactElement => {
  const { toast } = useToast()
  const rotate = useRotateSecretMutation()
  const unclaim = useUnclaimDeviceMutation()
  const remove = useDeleteDeviceMutation()

  const [rotated, setRotated] = useState<string | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [unclaimOpen, setUnclaimOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleteError, setDeleteError] = useState<string | undefined>()

  const openRotate = useCallback(() => setRotateOpen(true), [])
  const closeRotate = useCallback((next: boolean) => {
    setRotateOpen(next)
    if (!next) setRotated(null)
  }, [])
  const doRotate = useCallback(async () => {
    try {
      const res = await rotate.mutateAsync({ deviceId })
      setRotated(res.secret)
    } catch (err) {
      toast({
        title: "Couldn't rotate the secret",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
    }
  }, [deviceId, rotate, toast])

  const openUnclaim = useCallback(() => setUnclaimOpen(true), [])
  const closeUnclaim = useCallback((next: boolean) => setUnclaimOpen(next), [])
  const doUnclaim = useCallback(async () => {
    setUnclaimOpen(false)
    try {
      await unclaim.mutateAsync({ deviceId })
      toast({ title: 'Device unclaimed', tone: 'success' })
    } catch (err) {
      toast({
        title: "Couldn't unclaim the device",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
    }
  }, [deviceId, unclaim, toast])

  const openDelete = useCallback(() => setDeleteOpen(true), [])
  const closeDelete = useCallback((next: boolean) => {
    setDeleteOpen(next)
    if (!next) {
      setConfirmation('')
      setDeleteError(undefined)
    }
  }, [])
  const onConfirmation = useCallback(
    (e: FormEvent<HTMLInputElement>) => setConfirmation(e.currentTarget.value),
    [],
  )
  const doDelete = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setDeleteError(undefined)
      try {
        await remove.mutateAsync({ deviceId, confirmation })
      } catch (err) {
        setDeleteError(
          err instanceof ActionError
            ? (err.fieldErrors?.confirmation ?? err.message)
            : 'Could not delete the device. Try again.',
        )
        return
      }
      closeDelete(false)
      toast({ title: 'Device deleted', tone: 'success' })
    },
    [deviceId, confirmation, remove, closeDelete, toast],
  )

  return (
    <>
      <span className="flex items-center gap-1">
        <Button
          testId={`${testId}-rotate`}
          variant="ghost"
          size="sm"
          onClick={openRotate}
        >
          Rotate
        </Button>
        {memberCount > 0 ? (
          <Button
            testId={`${testId}-unclaim`}
            variant="ghost"
            size="sm"
            onClick={openUnclaim}
          >
            Unclaim
          </Button>
        ) : null}
        <Button
          testId={`${testId}-delete`}
          variant="ghost"
          size="sm"
          onClick={openDelete}
        >
          Delete
        </Button>
      </span>

      <Dialog
        testId={`${testId}-rotate-dialog`}
        open={rotateOpen}
        onOpenChange={closeRotate}
        title={rotated ? 'New secret' : 'Rotate the secret?'}
        description={
          rotated
            ? 'Flash it now — the device cannot ingest until it has this secret.'
            : `${deviceId} will stop ingesting until it is reflashed with the new secret.`
        }
      >
        {rotated ? (
          <SecretReveal
            testId={`${testId}-rotated`}
            deviceId={deviceId}
            secret={rotated}
          />
        ) : (
          <div className="flex justify-end">
            <Button
              testId={`${testId}-rotate-confirm`}
              variant="danger"
              loading={rotate.isPending}
              onClick={doRotate}
            >
              Rotate secret
            </Button>
          </div>
        )}
      </Dialog>

      <Dialog
        testId={`${testId}-unclaim-dialog`}
        open={unclaimOpen}
        onOpenChange={closeUnclaim}
        title="Unclaim this device?"
        description={`Everyone loses access to ${deviceId} and it becomes claimable again. Readings are kept.`}
      >
        <div className="flex justify-end">
          <Button
            testId={`${testId}-unclaim-confirm`}
            variant="danger"
            onClick={doUnclaim}
          >
            Unclaim
          </Button>
        </div>
      </Dialog>

      <Dialog
        testId={`${testId}-delete-dialog`}
        open={deleteOpen}
        onOpenChange={closeDelete}
        title="Delete this device?"
        description="The device and all of its readings are destroyed. This cannot be undone."
      >
        <form onSubmit={doDelete} className="flex flex-col gap-4" noValidate>
          <Field
            testId={`${testId}-delete-field`}
            label={`Type ${deviceId} to confirm`}
            htmlFor={`delete-${deviceId}`}
            error={deleteError}
          >
            <Input
              testId={`${testId}-delete-input`}
              id={`delete-${deviceId}`}
              value={confirmation}
              onChange={onConfirmation}
              mono
              invalid={!!deleteError}
            />
          </Field>
          <div className="flex justify-end">
            <Button
              testId={`${testId}-delete-confirm`}
              type="submit"
              variant="danger"
              loading={remove.isPending}
            >
              Delete device
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
