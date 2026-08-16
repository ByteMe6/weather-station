/** @jest-environment jsdom */
import { renderHook } from '@testing-library/react'

const getToken = jest.fn().mockResolvedValue('clerk-jwt')
// Stable identity across renders, like Clerk's real session object.
const session = { getToken }
jest.mock('@clerk/nextjs', () => ({
  useSession: () => ({ session }),
}))

const createClient = jest.fn<{ tag: string }, unknown[]>(() => ({
  tag: 'client',
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClient(...args),
}))

import { useSupabaseClient } from '@/lib/supabase'

describe('useSupabaseClient', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'pk'
  })

  it('creates one client per session and forwards the Clerk token', async () => {
    const { result, rerender } = renderHook(() => useSupabaseClient())
    rerender()
    expect(createClient).toHaveBeenCalledTimes(1)
    const opts = createClient.mock.calls[0]?.[2] as unknown as {
      accessToken: () => Promise<string | null>
    }
    await expect(opts.accessToken()).resolves.toBe('clerk-jwt')
    expect(result.current).toEqual({ tag: 'client' })
  })
})
