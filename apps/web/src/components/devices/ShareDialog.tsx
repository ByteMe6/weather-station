'use client'

import { useQueryClient } from '@tanstack/react-query'
import type { DeviceRole } from '@ws/shared'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { shareDeviceAction } from '@/actions/devices.action'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { deviceKeys } from '@/services/devices/devices.queries'

const ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer — can see readings' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner — can share and manage' },
]

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
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [identifier, setIdentifier] = useState('')
  const [role, setRole] = useState<DeviceRole>('viewer')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  const onIdentifier = useCallback(
    (e: FormEvent<HTMLInputElement>) => setIdentifier(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setPending(true)
      setError(undefined)
      const res = await shareDeviceAction({ deviceId, identifier, role })
      setPending(false)
      if (!res.ok) {
        setError(res.fieldErrors?.identifier ?? res.message)
        return
      }
      await queryClient.invalidateQueries({
        queryKey: deviceKeys.members(deviceId),
      })
      toast({ title: 'Access granted', tone: 'success' })
      setIdentifier('')
      onOpenChange(false)
    },
    [deviceId, identifier, role, queryClient, toast, onOpenChange],
  )

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title="Share access"
      description="They must have signed in to the web app or registered with the Telegram bot already."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          testId={`${testId}-identifier`}
          label="Clerk user ID or Telegram ID"
          htmlFor="share-identifier"
          error={error}
          hint="user_… from Clerk, or the numeric Telegram ID"
        >
          <Input
            testId={`${testId}-identifier-input`}
            id="share-identifier"
            mono
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
            loading={pending}
            disabled={identifier.trim().length === 0}
          >
            Share access
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
