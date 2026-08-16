/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react'

import { navState, routerState } from '../../../stubs/next-navigation'

import { useRangeParam } from '@/components/charts/useRangeParam'

describe('useRangeParam', () => {
  it('defaults to 24h, reads ?range=, and writes via router.replace', () => {
    navState.pathname = '/dashboard'
    navState.search = new URLSearchParams('')
    const { result } = renderHook(() => useRangeParam())
    expect(result.current[0]).toBe('24h')
    act(() => result.current[1]('7d'))
    expect(routerState.replace).toHaveBeenCalledWith('/dashboard?range=7d', {
      scroll: false,
    })
    navState.search = new URLSearchParams('range=30d')
    const { result: r2 } = renderHook(() => useRangeParam())
    expect(r2.current[0]).toBe('30d')
    navState.search = new URLSearchParams('range=bogus')
    const { result: r3 } = renderHook(() => useRangeParam())
    expect(r3.current[0]).toBe('24h')
  })
})
