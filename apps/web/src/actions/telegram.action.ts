'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { TELEGRAM_LINK_TTL_MS } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId } from './_helpers'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import {
  configuredBotUsername,
  generateLinkCode,
  telegramDeepLink,
} from '@/lib/telegram'

/**
 * The configured bot username, or null when it is unusable. `@name` and full
 * t.me URLs are what actually get pasted in, and both used to sail through
 * into a deep link that never opens the bot — so a bad value now fails loudly
 * at "Link Telegram" instead of silently at the tap. Shared with the settings
 * card so both links in it resolve to the same bot.
 */
const botUsername = (): string | null => {
  const username = configuredBotUsername()
  if (!username && process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim())
    console.error(
      'NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is not a Telegram username',
    )
  return username
}

export type TelegramLinkState = 'pending' | 'linked' | 'expired' | 'failed'

// Codes are minted by generateLinkCode(): 20 Crockford-base32 characters.
const codeSchema = z.object({
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{20}$/),
})

// redeem_telegram_link_code() stores the machine reason it raised, so the copy
// lives here rather than being whatever string the bot happened to reply with.
// Both refusals are fixable, and the code stays redeemable — so each message
// says what to do, not just what went wrong.
const FAILURE_COPY: Record<string, string> = {
  ALREADY_LINKED_OTHER:
    'Your account is already linked to a different Telegram account. Unlink it below, then open the link again.',
  TELEGRAM_BELONGS_TO_ACCOUNT:
    'That Telegram account is already linked to another Weather Station account.',
}

// Note on ALREADY_LINKED_OTHER: merge_telegram_identity raises it only when the
// caller's users row already carries a different telegram_id, and the card
// renders `failReason` solely inside the pending panel — which does not mount
// once `linkedId !== null`. So this copy is currently unreachable in the UI;
// it is kept correct for the day that branch gets handled in the linked state.
const describeFailure = (reason: string): string =>
  FAILURE_COPY[reason] ?? 'Could not finish linking. Try again from settings.'

/** MRP-37: mint a one-time code; the user opens the deep link and the bot verifies ownership. */
export const startTelegramLinkAction = async (): Promise<
  ActionResult<{ code: string; deepLink: string; expiresAt: string }>
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const bot = botUsername()
  if (!bot)
    return actionError(
      'NOT_CONFIGURED',
      'Telegram linking is not configured yet',
    )
  const service = createServiceRoleClient()
  let userId: string | null
  try {
    userId = await resolveCurrentUserId(service, clerkUserId)
  } catch (err) {
    console.error('startTelegramLinkAction failed', err)
    return actionError('UNKNOWN', 'Could not start linking. Try again.')
  }
  if (!userId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const code = generateLinkCode()
  // Built before the insert, not after. The builder validates independently of
  // botUsername(), so refusing here once the row exists would leave an orphan
  // code behind on every click if the two ever diverged — and the refusal copy
  // is already above.
  const deepLink = telegramDeepLink(bot, code)
  if (!deepLink)
    return actionError(
      'NOT_CONFIGURED',
      'Telegram linking is not configured yet',
    )
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS).toISOString()
  const { error } = await service
    .from('telegram_link_codes')
    .insert({ code, user_id: userId, expires_at: expiresAt })
  if (error) {
    console.error('startTelegramLinkAction failed', error)
    return actionError('UNKNOWN', 'Could not start linking. Try again.')
  }
  return actionOk({ code, deepLink, expiresAt })
}

export const getTelegramLinkStatusAction = async (input: {
  code: string
}): Promise<ActionResult<{ state: TelegramLinkState; reason?: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const parsed = codeSchema.safeParse(input)
  if (!parsed.success) return actionError('NOT_FOUND', 'Unknown link code')
  const service = createServiceRoleClient()
  let userId: string | null
  try {
    userId = await resolveCurrentUserId(service, clerkUserId)
  } catch (err) {
    console.error('getTelegramLinkStatusAction failed', err)
    return actionError('UNKNOWN', 'Could not check the link. Try again.')
  }
  if (!userId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const { data, error } = await service
    .from('telegram_link_codes')
    .select('consumed_at, expires_at, failed_reason')
    .eq('code', parsed.data.code)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('getTelegramLinkStatusAction failed', error)
    return actionError('UNKNOWN', 'Could not check the link. Try again.')
  }
  if (!data) return actionError('NOT_FOUND', 'Unknown link code')
  // One expiry decision for the whole function. `Number.isFinite` matches the
  // hook's guard: a malformed timestamp used to read as "not expired" here and
  // as "keep polling" there, so the two disagreed on the same row.
  const deadline = new Date(data.expires_at).getTime()
  const expired = Number.isFinite(deadline) && deadline < Date.now()
  // Expiry outranks a recorded refusal on an unspent code. A refusal leaves the
  // code redeemable and both refusal messages say to open the same link again -
  // advice redeem_telegram_link_code() stops honouring at the TTL, so past it
  // the card would be telling the user to do something that cannot work.
  if (expired && !data.consumed_at) return actionOk({ state: 'expired' })
  // redeem_telegram_link_code() records the machine reason and leaves the code
  // unspent, so the user can fix the cause and reuse the same deep link.
  if (data.failed_reason)
    return actionOk({
      state: 'failed',
      reason: describeFailure(data.failed_reason),
    })
  if (data.consumed_at) {
    // Redemption is atomic, so a spent code means the merge committed. The
    // cross-check stays as a belt-and-braces read: reporting "linked" off the
    // code alone would say "Telegram linked" while alerts never arrive.
    const { data: linked, error: linkedError } = await service
      .from('users')
      .select('telegram_id')
      .eq('id', userId)
      .maybeSingle()
    if (linkedError) {
      console.error(
        'getTelegramLinkStatusAction: link check failed',
        linkedError,
      )
      return actionError('UNKNOWN', 'Could not check the link. Try again.')
    }
    if (linked?.telegram_id !== null && linked?.telegram_id !== undefined)
      return actionOk({ state: 'linked' })
    // Consumed but not linked is now unreachable. If it ever happens again,
    // it is transient, not terminal — this used to answer "Linking did not
    // finish. Start again from settings.", which stopped the poll for good and
    // condemned links that had actually succeeded a moment later.
    return actionOk({ state: expired ? 'expired' : 'pending' })
  }
  // Unspent-and-expired already returned above, so anything reaching here is
  // unspent and live. (A second `if (expired)` used to sit here and could never
  // fire — a later reader adjusting it would have seen no effect.)
  return actionOk({ state: 'pending' })
}

export const unlinkTelegramAction = async (): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('users')
    .update({ telegram_id: null })
    .eq('clerk_user_id', clerkUserId)
    .select('id')
  if (error) {
    console.error('unlinkTelegramAction failed', error)
    return actionError('UNKNOWN', 'Could not unlink. Try again.')
  }
  // No row means there is no users row for this Clerk id — reporting "unlinked"
  // would be a success message for a write that did nothing.
  if ((data ?? []).length !== 1) {
    return actionError('UNAUTHORIZED', 'Sign in to continue')
  }
  return actionOk(null)
}
