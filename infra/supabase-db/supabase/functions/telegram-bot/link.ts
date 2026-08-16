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

const INVALID =
  'That link is invalid or was already used. Start again from the web app.'
const EXPIRED = 'That link expired. Start again from the web app.'

export const handleLinkCode = async (
  code: string,
  telegramId: number,
): Promise<string> => {
  const db = service()
  const now = new Date().toISOString()

  // Claim the code in one statement: only an unconsumed, unexpired row is
  // updated, so two taps of the same link (or a forwarded link) cannot both
  // pass a read-then-check and overwrite users.telegram_id twice.
  const { data: claimed, error: claimError } = await db
    .from('telegram_link_codes')
    .update({ consumed_at: now })
    .eq('code', code)
    .is('consumed_at', null)
    .gt('expires_at', now)
    .select('user_id')
    .maybeSingle()
  if (claimError) return 'Could not link right now.'
  if (!claimed) {
    // Nothing claimed — tell the user why, without changing anything.
    const { data: row } = await db
      .from('telegram_link_codes')
      .select('expires_at, consumed_at')
      .eq('code', code)
      .maybeSingle()
    const expired =
      row &&
      !row.consumed_at &&
      new Date(row.expires_at as string).getTime() < Date.now()
    return expired ? EXPIRED : INVALID
  }

  const { error } = await db
    .from('users')
    .update({ telegram_id: telegramId })
    .eq('id', claimed.user_id)
  if (error) {
    const reason =
      error.code === '23505'
        ? 'This Telegram account is already linked to another user.'
        : 'Could not link right now.'
    // The claim stands (the code is spent); the web polls failed_reason
    // before consumed_at, so it shows the failure instead of "linked".
    await db
      .from('telegram_link_codes')
      .update({ failed_reason: reason })
      .eq('code', code)
    return reason
  }
  return 'Linked! Your Telegram account is now connected to your Weather Station account.'
}
