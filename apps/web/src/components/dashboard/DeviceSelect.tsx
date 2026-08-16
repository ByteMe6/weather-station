'use client'

import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { Select } from '@/components/ui/Select'
import type { MyDevice } from '@/services/devices/devices.service'

export const DeviceSelect = ({
  devices,
  value,
  onChange,
  testId,
}: {
  devices: MyDevice[]
  value: string
  onChange: (deviceId: string) => void
  testId: string
}): ReactElement => {
  const options = useMemo(
    () =>
      devices.map((d) => ({
        value: d.deviceId,
        label: `${d.deviceId} · ${d.role}`,
      })),
    [devices],
  )
  return (
    <Select
      testId={testId}
      ariaLabel="Station"
      value={value}
      onValueChange={onChange}
      options={options}
    />
  )
}
