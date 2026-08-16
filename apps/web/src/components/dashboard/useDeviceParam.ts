'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

/**
 * Selected station persists in the URL (?device=). Returns the raw param;
 * callers fall back to the first device they have access to.
 */
export const useDeviceParam = (): [
  string | null,
  (deviceId: string) => void,
] => {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const selected = params.get('device')
  const setSelected = useCallback(
    (deviceId: string) => {
      const q = new URLSearchParams(params.toString())
      q.set('device', deviceId)
      router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )
  return [selected, setSelected]
}
