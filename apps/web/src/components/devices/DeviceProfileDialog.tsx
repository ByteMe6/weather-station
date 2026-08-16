'use client'

import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import { useUpdateDeviceProfileMutation } from '@/services/devices/devices.queries'

interface DeviceProfileDialogProps {
  testId: string
  deviceId: string
  label: string | null
  address: string | null
  open: boolean
  onOpenChange: (o: boolean) => void
}

export const DeviceProfileDialog = ({
  testId,
  deviceId,
  label,
  address,
  open,
  onOpenChange,
}: DeviceProfileDialogProps): ReactElement => {
  const { toast } = useToast()
  const save = useUpdateDeviceProfileMutation(deviceId)
  const [labelValue, setLabelValue] = useState(label ?? '')
  const [addressValue, setAddressValue] = useState(address ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const onLabel = useCallback(
    (e: FormEvent<HTMLInputElement>) => setLabelValue(e.currentTarget.value),
    [],
  )
  const onAddress = useCallback(
    (e: FormEvent<HTMLInputElement>) => setAddressValue(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setErrors({})
      try {
        await save.mutateAsync({ label: labelValue, address: addressValue })
      } catch (err) {
        setErrors(
          err instanceof ActionError
            ? (err.fieldErrors ?? { label: err.message })
            : { label: 'Could not save the station details. Try again.' },
        )
        return
      }
      toast({ title: 'Station details saved', tone: 'success' })
      onOpenChange(false)
    },
    [labelValue, addressValue, save, toast, onOpenChange],
  )

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title="Station details"
      description="A nickname shows instead of the id everywhere; the address is free text for now (a map view comes later)."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          testId={`${testId}-label`}
          label="Nickname"
          htmlFor="device-label"
          error={errors.label}
          hint="e.g. Backyard, School roof"
        >
          <Input
            testId={`${testId}-label-input`}
            id="device-label"
            value={labelValue}
            onChange={onLabel}
            maxLength={40}
            invalid={!!errors.label}
          />
        </Field>
        <Field
          testId={`${testId}-address`}
          label="Address"
          htmlFor="device-address"
          error={errors.address}
          hint="Street, city — helps when you have several stations"
        >
          <Input
            testId={`${testId}-address-input`}
            id="device-address"
            value={addressValue}
            onChange={onAddress}
            maxLength={200}
            invalid={!!errors.address}
          />
        </Field>
        <div className="flex justify-end">
          <Button
            testId={`${testId}-save`}
            type="submit"
            loading={save.isPending}
          >
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
