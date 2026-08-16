'use client'

import { useRouter } from 'next/navigation'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { ActionError } from '@/lib/actions/unwrap'
import { useRegisterDeviceMutation } from '@/services/devices/devices.queries'

export const RegisterDeviceForm = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  const router = useRouter()
  const { toast } = useToast()
  const register = useRegisterDeviceMutation()
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState<string | undefined>()

  const onChange = useCallback(
    (e: FormEvent<HTMLInputElement>) => setDeviceId(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setError(undefined)
      let registered: { deviceId: string }
      try {
        registered = await register.mutateAsync({ deviceId })
      } catch (err) {
        setError(
          err instanceof ActionError
            ? (err.fieldErrors?.deviceId ?? err.message)
            : 'Could not register the station. Try again.',
        )
        return
      }
      toast({
        title: 'Station registered',
        description: `${registered.deviceId} is now yours.`,
        tone: 'success',
      })
      router.replace('/dashboard')
    },
    [deviceId, register, router, toast],
  )

  return (
    <Card testId={testId} className="mx-auto w-full max-w-md">
      <CardBody testId={`${testId}-body`} className="pt-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Register your station
        </h1>
        <p className="text-slate mt-1 mb-5 text-sm">
          Enter the ID printed on the label under the device.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            testId={`${testId}-field`}
            label="Station ID"
            htmlFor="device-id"
            error={error}
            hint="Looks like ws-3f2a9b7c1d0e"
          >
            <Input
              testId={`${testId}-input`}
              id="device-id"
              mono
              placeholder="ws-xxxxxxxxxxxx"
              autoComplete="off"
              value={deviceId}
              onChange={onChange}
              invalid={!!error}
            />
          </Field>
          <Button
            testId={`${testId}-submit`}
            type="submit"
            loading={register.isPending}
            disabled={deviceId.trim().length === 0}
          >
            Register device
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
