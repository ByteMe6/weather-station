'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { FormEvent, ReactElement } from 'react'
import { useCallback, useState } from 'react'

import { registerDeviceAction } from '@/actions/devices.action'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { deviceKeys } from '@/services/devices/devices.queries'

export const RegisterDeviceForm = ({
  testId,
}: {
  testId: string
}): ReactElement => {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  const onChange = useCallback(
    (e: FormEvent<HTMLInputElement>) => setDeviceId(e.currentTarget.value),
    [],
  )

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      setPending(true)
      setError(undefined)
      const result = await registerDeviceAction({ deviceId })
      setPending(false)
      if (!result.ok) {
        setError(result.fieldErrors?.deviceId ?? result.message)
        return
      }
      await queryClient.invalidateQueries({ queryKey: deviceKeys.all })
      toast({
        title: 'Station registered',
        description: `${result.data.deviceId} is now yours.`,
        tone: 'success',
      })
      router.replace('/dashboard')
    },
    [deviceId, queryClient, router, toast],
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
            loading={pending}
            disabled={deviceId.trim().length === 0}
          >
            Register device
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
