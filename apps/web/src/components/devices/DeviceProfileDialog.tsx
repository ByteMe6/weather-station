'use client'

import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import { formatCoordinate, parseCoordinateInput } from '@/lib/coordinates'
import { useUpdateDeviceProfileMutation } from '@/services/devices/devices.queries'

interface DeviceProfileDialogProps {
  testId: string
  deviceId: string
  label: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  open: boolean
  onOpenChange: (o: boolean) => void
}

export const DeviceProfileDialog = ({
  testId,
  deviceId,
  label,
  address,
  latitude,
  longitude,
  open,
  onOpenChange,
}: DeviceProfileDialogProps): ReactElement => {
  const { toast } = useToast()
  const save = useUpdateDeviceProfileMutation(deviceId)
  const [labelValue, setLabelValue] = useState(label ?? '')
  const [addressValue, setAddressValue] = useState(address ?? '')
  const [latValue, setLatValue] = useState(
    latitude === null ? '' : formatCoordinate(latitude),
  )
  const [lngValue, setLngValue] = useState(
    longitude === null ? '' : formatCoordinate(longitude),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const onLabel = useCallback(
    (e: FormEvent<HTMLInputElement>) => setLabelValue(e.currentTarget.value),
    [],
  )
  const onAddress = useCallback(
    (e: FormEvent<HTMLInputElement>) => setAddressValue(e.currentTarget.value),
    [],
  )
  // Pasting "49.8397, 24.0297" into latitude fills both fields (lib/coordinates).
  const onLatitude = useCallback((e: FormEvent<HTMLInputElement>) => {
    const parsed = parseCoordinateInput(e.currentTarget.value)
    setLatValue(parsed.latitude)
    if (parsed.longitude !== undefined) setLngValue(parsed.longitude)
  }, [])
  const onLongitude = useCallback(
    (e: FormEvent<HTMLInputElement>) => setLngValue(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setErrors({})
      try {
        await save.mutateAsync({
          label: labelValue,
          address: addressValue,
          latitude: latValue,
          longitude: lngValue,
        })
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
    [labelValue, addressValue, latValue, lngValue, save, toast, onOpenChange],
  )

  return (
    <Dialog
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
      title="Station details"
      description="A nickname shows instead of the id everywhere. Coordinates put the station on the map on your devices page."
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
        <div className="grid grid-cols-2 gap-3">
          <Field
            testId={`${testId}-latitude`}
            label="Latitude"
            htmlFor="device-latitude"
            error={errors.latitude}
            hint="From your phone's GPS — paste both numbers here"
          >
            <Input
              testId={`${testId}-latitude-input`}
              id="device-latitude"
              value={latValue}
              onChange={onLatitude}
              inputMode="decimal"
              placeholder="49.839700"
              mono
              invalid={!!errors.latitude}
            />
          </Field>
          <Field
            testId={`${testId}-longitude`}
            label="Longitude"
            htmlFor="device-longitude"
            error={errors.longitude}
            hint="Leave both empty to hide the station from the map"
          >
            <Input
              testId={`${testId}-longitude-input`}
              id="device-longitude"
              value={lngValue}
              onChange={onLongitude}
              inputMode="decimal"
              placeholder="24.029700"
              mono
              invalid={!!errors.longitude}
            />
          </Field>
        </div>
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
