// MRP-37 web ↔ bot account linking: `/start link_<code>`.
//
// The web app mints a one-time code (telegram_link_codes) and shows a deep
// link; when the user taps Start we get here. Service-role client (RLS
// bypassed): the Telegram ID comes from the update itself, never from text.
//
// MRP-39 (PRD OQ3): linking is also the merge path. If this Telegram account
// already had its own telegram-only `users` row, merge_telegram_identity()
// absorbs it — stations and alert slots move to the web account and the
// duplicate row is deleted — inside one transaction. Before that, this
// finished with a bare `update users set telegram_id`, which tripped the
// unique index and dead-ended the user with "already linked to another user".
//
// Redemption is one RPC, therefore one transaction. It used to be two round
// trips — claim the code, then merge — and the row between them read as
// "consumed but not linked", which the web reported as a terminal
// "Linking did not finish." A poll landing in that gap, or this function
// dying between the calls, permanently failed a link that had worked.
import type { SupabaseClient } from '@supabase/supabase-js'

export const LINK_PREFIX = 'link_'

const INVALID =
  'That link is invalid or was already used. Start again from the web app.'
const EXPIRED = 'That link expired. Start again from the web app.'
const GENERIC = 'Could not link right now.'

/** Shape of the `telegram_merge_result` composite the RPC returns. */
interface MergeResult {
  merged: boolean
  devicesMoved: number
  schedulesMoved: number
}

// rpc() rows cannot be aliased in the query string (CLAUDE.md), so the
// snake_case composite is mapped here instead.
const toMergeResult = (row: unknown): MergeResult | null => {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (
    typeof r.merged !== 'boolean' ||
    typeof r.devices_moved !== 'number' ||
    typeof r.schedules_moved !== 'number'
  ) {
    return null
  }
  return {
    merged: r.merged,
    devicesMoved: r.devices_moved,
    schedulesMoved: r.schedules_moved,
  }
}

/** Shape of the `telegram_redeem_result` composite the RPC returns. */
interface RedeemResult extends MergeResult {
  outcome: 'linked' | 'expired' | 'invalid' | 'refused'
  reason: string | null
}

const OUTCOMES = ['linked', 'expired', 'invalid', 'refused'] as const

const isOutcome = (v: unknown): v is RedeemResult['outcome'] =>
  typeof v === 'string' && (OUTCOMES as readonly string[]).includes(v)

// rpc() rows cannot be aliased in the query string (CLAUDE.md), so the
// snake_case composite is mapped here instead.
const toRedeemResult = (row: unknown): RedeemResult | null => {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  if (!isOutcome(r.outcome)) return null
  const merge = toMergeResult(row)
  return {
    outcome: r.outcome,
    reason: typeof r.reason === 'string' ? r.reason : null,
    merged: merge?.merged ?? false,
    devicesMoved: merge?.devicesMoved ?? 0,
    schedulesMoved: merge?.schedulesMoved ?? 0,
  }
}

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`

/**
 * The reply after a successful link. A merge names what came across, so the
 * user can see their stations were not lost — that silence is exactly what
 * made the old failure feel destructive.
 */
export const linkedText = (merge: MergeResult | null): string => {
  const base =
    'Linked! Your Telegram account is now connected to your Weather Station account.'
  if (!merge?.merged) return base
  const carried = [
    merge.devicesMoved > 0
      ? plural(merge.devicesMoved, 'station', 'stations')
      : null,
    merge.schedulesMoved > 0
      ? plural(merge.schedulesMoved, 'alert', 'alerts')
      : null,
  ].filter((part): part is string => part !== null)
  if (carried.length === 0) return base
  return `${base}\n\nI brought ${carried.join(' and ')} from this chat across to it.`
}

/**
 * Postgres raises these as P0001; the text is what reaches the user. A refusal
 * no longer spends the code, so these say to come back to the same link rather
 * than to start over.
 */
export const mapMergeError = (message: string): string => {
  if (message.includes('ALREADY_LINKED_OTHER'))
    return 'Your Weather Station account is already linked to a different Telegram account. Unlink it on the web, then open this link again.'
  if (message.includes('TELEGRAM_BELONGS_TO_ACCOUNT'))
    return 'This Telegram account is already linked to another user.'
  return GENERIC
}

/**
 * Redeem `/start link_<code>`. Validation, the identity merge and spending the
 * code all happen inside redeem_telegram_link_code(), so there is no
 * intermediate state for the web poll to misread.
 *
 * A refusal deliberately leaves the code unspent: both refusals mean "fix
 * something and come back", and burning the code would strand the user the way
 * the old flow did. The reason is recorded on the row for the web to show.
 */
export const handleLinkCode = async (
  db: SupabaseClient,
  code: string,
  telegramId: number,
): Promise<string> => {
  const { data, error } = await db.rpc('redeem_telegram_link_code', {
    p_code: code,
    p_telegram_id: telegramId,
  })
  if (error) {
    // Logged, not swallowed: this is the only trace a DB outage leaves, and
    // without it the web polls "pending" until the code expires while nobody
    // learns Postgres refused the call.
    console.error('handleLinkCode: redeem failed', { error })
    return GENERIC
  }

  const result = toRedeemResult(data)
  if (!result) {
    console.error('handleLinkCode: unreadable redeem payload', { data })
    return GENERIC
  }

  switch (result.outcome) {
    case 'linked':
      return linkedText(result)
    case 'expired':
      return EXPIRED
    case 'refused':
      return mapMergeError(result.reason ?? '')
    default:
      return INVALID
  }
}
