'use client'

import type { DeviceRole } from '@ws/shared'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { ROLE_OPTIONS_WITH_CAPABILITY as ROLE_OPTIONS } from './roleOptions'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import { useShareDeviceMutation } from '@/services/devices/devices.queries'

export const ShareDialog = ({
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
  const share = useShareDeviceMutation(deviceId)
  const [identifier, setIdentifier] = useState('')
  const [role, setRole] = useState<DeviceRole>('viewer')
  const [error, setError] = useState<string | undefined>()

  const onIdentifier = useCallback(
    (e: FormEvent<HTMLInputElement>) => setIdentifier(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(undefined)
      try {
        await share.mutateAsync({ identifier, role })
      } catch (err) {
        setError(
          err instanceof ActionError
            ? (err.fieldErrors?.identifier ?? err.message)
            : 'Could not share the station. Try again.',
        )
        return
      }
      toast({ title: 'Access granted', tone: 'success' })
      setIdentifier('')
      onOpenChange(false)
    },
    [identifier, role, share, toast, onOpenChange],
  )

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title="Share access"
      description="They need a Weather Station account already — a web sign-in, or the Telegram bot."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          testId={`${testId}-identifier`}
          label="Email or Telegram ID"
          htmlFor="share-identifier"
          error={error}
          hint="The email they sign in with, or their numeric Telegram ID"
        >
          <Input
            testId={`${testId}-identifier-input`}
            id="share-identifier"
            value={identifier}
            onChange={onIdentifier}
            invalid={!!error}
            autoComplete="off"
          />
        </Field>
        <Field testId={`${testId}-role`} label="Role" htmlFor="share-role">
          <Select<DeviceRole>
            testId={`${testId}-role-select`}
            ariaLabel="Role"
            value={role}
            onValueChange={setRole}
            options={ROLE_OPTIONS}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            testId={`${testId}-submit`}
            type="submit"
            loading={share.isPending}
            disabled={identifier.trim().length === 0}
          >
            Share access
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
