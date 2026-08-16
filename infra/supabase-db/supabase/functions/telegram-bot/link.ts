// MRP-37 web ↔ bot account linking: `/start link_<code>`.
//
// The web app mints a one-time code (telegram_link_codes) and shows a deep
// link; when the user taps Start we get here. Service-role client (RLS
// bypassed): the Telegram ID comes from the update itself, never from text.
import { createClient } from '@supabase/supabase-js'

export const LINK_PREFIX = 'link_'

const service = () => {
  const url = Deno.env.get('SUPABASE_URL')
  const key =
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key)
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set')
  return createClient(url, key)
}

export const handleLinkCode = async (
  code: string,
  telegramId: number,
): Promise<string> => {
  const db = service()
  const { data: row } = await db
    .from('telegram_link_codes')
    .select('code, user_id, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle()
  if (!row || row.consumed_at) {
    return 'That link is invalid or was already used. Start again from the web app.'
  }
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return 'That link expired. Start again from the web app.'
  }

  const { error } = await db
    .from('users')
    .update({ telegram_id: telegramId })
    .eq('id', row.user_id)
  if (error) {
    const reason =
      error.code === '23505'
        ? 'This Telegram account is already linked to another user.'
        : 'Could not link right now.'
    await db
      .from('telegram_link_codes')
      .update({ failed_reason: reason })
      .eq('code', code)
    return reason
  }
  await db
    .from('telegram_link_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code', code)
  return 'Linked! Your Telegram account is now connected to your Weather Station account.'
}
