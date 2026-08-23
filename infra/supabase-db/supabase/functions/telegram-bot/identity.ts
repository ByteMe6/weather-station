// telegram_id → users.id (PRD T3). The id comes from the update, never text.
import type { SupabaseClient } from '@supabase/supabase-js'

export const ensureUserId = async (
  db: SupabaseClient,
  telegramId: number,
): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  if (error) throw new Error(`user lookup failed: ${error.message}`)
  if (data) return data.id as string

  const inserted = await db
    .from('users')
    .insert({ telegram_id: telegramId })
    .select('id')
    .single()
  if (!inserted.error) return inserted.data.id as string
  if (inserted.error.code === '23505') {
    // Two updates raced; the row exists now.
    const again = await db
      .from('users')
      .select('id')
      .eq('telegram_id', telegramId)
      .single()
    if (again.error)
      throw new Error(`user re-lookup failed: ${again.error.message}`)
    return again.data.id as string
  }
  throw new Error(`user insert failed: ${inserted.error.message}`)
}
