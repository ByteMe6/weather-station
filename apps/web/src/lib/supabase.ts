'use client'

import { useSession } from '@clerk/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'
import { useMemo } from 'react'

/**
 * Publishable-key client with the Clerk session token attached, so Postgres
 * RLS resolves the user via current_app_user_id(). One client per session.
 */
export const useSupabaseClient = (): SupabaseClient<Database> => {
  const { session } = useSession()
  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        { accessToken: async () => (await session?.getToken()) ?? null },
      ),
    [session],
  )
}
