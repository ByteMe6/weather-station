import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { ServiceError } from '../database/types'

export interface CurrentUser {
  id: string
  clerkUserId: string | null
  telegramId: number | null
  createdAt: string
}

/** Own `users` row (RLS: "users can view own profile"). Null before the first ensureCurrentUserAction. */
export const fetchCurrentUser = async (
  supabase: SupabaseClient<Database>,
): Promise<CurrentUser | null> => {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, clerkUserId:clerk_user_id, telegramId:telegram_id, createdAt:created_at',
    )
    .maybeSingle()

  if (error) {
    throw new ServiceError(
      `Failed to fetch current user: ${error.message}`,
      error.code,
      error.details,
    )
  }
  return data
}
