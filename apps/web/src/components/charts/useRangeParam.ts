'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'

import type { HistoryRange } from '@/lib/chart'

const RANGES: HistoryRange[] = ['24h', '7d', '30d']
const isRange = (v: string | null): v is HistoryRange =>
  v !== null && (RANGES as string[]).includes(v)

/** Range persists in the URL (?range=) so it survives navigation and refresh (spec §4.2). */
export const useRangeParam = (): [HistoryRange, (r: HistoryRange) => void] => {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const raw = params.get('range')
  const range: HistoryRange = isRange(raw) ? raw : '24h'
  const setRange = useCallback(
    (next: HistoryRange) => {
      const q = new URLSearchParams(params.toString())
      if (next === '24h') q.delete('range')
      else q.set('range', next)
      const qs = q.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router],
  )
  return [range, setRange]
}
