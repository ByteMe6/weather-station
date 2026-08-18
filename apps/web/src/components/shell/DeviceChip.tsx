'use client'

import type { ReactElement } from 'react'
import { useMemo } from 'react'

import { Select } from '@/components/ui/Select'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import type { MyDevice } from '@/services/devices/devices.service'
import { deviceDisplayName } from '@/services/devices/devices.service'

/**
 * Station indicator: nothing at all with no stations, a plain label with one,
 * a dropdown with several (the selection lives in ?device=).
 *
 * Visibility is the caller's decision, not this component's — the top bar
 * shows it only at `lg` and above, while the mobile drawer shows it always.
 */
export const DeviceChip = ({
  devices,
  selectedDeviceId,
  onSelect,
  loading = false,
  className,
  testId,
}: {
  devices: MyDevice[]
  selectedDeviceId: string | null
  onSelect: (deviceId: string) => void
  /** True while the devices query is pending — never flash the empty state. */
  loading?: boolean
  /** Visibility/display classes from whichever layout is rendering this. */
  className?: string
  testId: string
}): ReactElement | null => {
  const options = useMemo(
    () =>
      devices.map((d) => ({
        value: d.deviceId,
        label: d.device?.label
          ? `${deviceDisplayName(d)} · ${d.deviceId}`
          : d.deviceId,
      })),
    [devices],
  )

  if (loading) {
    return (
      <Skeleton
        testId={`${testId}-skeleton`}
        className={cn('h-3 w-28', className)}
      />
    )
  }
  if (devices.length === 0) return null

  if (devices.length === 1) {
    return (
      <span
        data-testid={testId}
        className={cn(
          'text-slate items-center gap-2 font-mono text-xs',
          className,
        )}
      >
        <span>Station</span>
        <b className="text-ink font-medium">{deviceDisplayName(devices[0]!)}</b>
      </span>
    )
  }
  return (
    <span data-testid={testId} className={className}>
      <Select
        testId={`${testId}-select`}
        ariaLabel="Station"
        value={selectedDeviceId ?? devices[0]!.deviceId}
        onValueChange={onSelect}
        options={options}
      />
    </span>
  )
}
