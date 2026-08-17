'use client'

import type { ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { SecretReveal } from './SecretReveal'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { useToast } from '@/components/ui/Toast'
import { useCreateDeviceMutation } from '@/services/admin/admin.queries'

interface Created {
  deviceId: string
  secret: string
}

/**
 * Mints a device. The secret exists in this component's state and nowhere else
 * afterwards — closing the dialog drops it, and no read path can recover it.
 */
export const CreateDeviceDialog = ({
  open,
  onOpenChange,
  testId,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  testId: string
}): ReactElement => {
  const { toast } = useToast()
  const create = useCreateDeviceMutation()
  const [created, setCreated] = useState<Created | null>(null)

  const onCreate = useCallback(async () => {
    try {
      setCreated(await create.mutateAsync())
    } catch (err) {
      toast({
        title: "Couldn't create the device",
        description: err instanceof Error ? err.message : undefined,
        tone: 'danger',
      })
    }
  }, [create, toast])

  const close = useCallback(
    (next: boolean) => {
      if (!next) setCreated(null)
      onOpenChange(next)
    },
    [onOpenChange],
  )
  const done = useCallback(() => close(false), [close])

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={close}
      title={created ? 'Device created' : 'Create device'}
      description={
        created
          ? 'Flash these into the device now.'
          : 'Mints a station id and its HMAC secret. The device stays unregistered until someone claims it.'
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <SecretReveal
            testId={`${testId}-secret`}
            deviceId={created.deviceId}
            secret={created.secret}
          />
          <div className="flex justify-end">
            <Button testId={`${testId}-done`} onClick={done}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            testId={`${testId}-submit`}
            loading={create.isPending}
            onClick={onCreate}
          >
            Create device
          </Button>
        </div>
      )}
    </Dialog>
  )
}
