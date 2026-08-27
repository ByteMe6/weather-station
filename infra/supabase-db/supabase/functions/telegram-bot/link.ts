// MRP-37 web ↔ bot account linking: `/start link_<code>`.
//
// The web app mints a one-time code (telegram_link_codes) and shows a deep
// link; when the user taps Start we get here. Service-role client (RLS
// bypassed): the Telegram ID comes from the update itself, never from text.
import { serviceClient } from '../_shared/db.ts'

export const LINK_PREFIX = 'link_'

const INVALID =
  'That link is invalid or was already used. Start again from the web app.'
const EXPIRED = 'That link expired. Start again from the web app.'

export const handleLinkCode = async (
  code: string,
  telegramId: number,
): Promise<string> => {
  const db = serviceClient()
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
  if (claimError) {
    // Logged, not swallowed: this is the only trace a DB outage leaves, and
    // without it the web polls "pending" until the code expires while nobody
    // learns Postgres refused the update.
    console.error('handleLinkCode: claim failed', { code, error: claimError })
    return 'Could not link right now.'
  }
  if (!claimed) {
    // Nothing claimed — tell the user why, without changing anything.
    const { data: row, error: rowError } = await db
      .from('telegram_link_codes')
      .select('expires_at, consumed_at')
      .eq('code', code)
      .maybeSingle()
    if (rowError) {
      // Discarding this told the user "invalid or already used" for what was
      // actually a transient failure, sending them to retry into the same wall.
      console.error('handleLinkCode: lookup failed', { code, error: rowError })
      return 'Could not link right now.'
    }
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
    // This write is what stops a claimed-but-unlinked code from reading as
    // "linked" on the web, so its own failure has to be visible.
    const { error: markError } = await db
      .from('telegram_link_codes')
      .update({ failed_reason: reason })
      .eq('code', code)
    if (markError) {
      console.error('handleLinkCode: could not record failure', {
        code,
        error: markError,
      })
    }
    return reason
  }
  return 'Linked! Your Telegram account is now connected to your Weather Station account.'
}
