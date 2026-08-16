'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { TELEGRAM_LINK_TTL_MS } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId } from './_helpers'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { generateLinkCode, telegramDeepLink } from '@/lib/telegram'

const botUsername = (): string | null =>
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null

export type TelegramLinkState = 'pending' | 'linked' | 'expired' | 'failed'

// Codes are minted by generateLinkCode(): 20 Crockford-base32 characters.
const codeSchema = z.object({
  code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{20}$/),
})

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
  const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS).toISOString()
  const { error } = await service
    .from('telegram_link_codes')
    .insert({ code, user_id: userId, expires_at: expiresAt })
  if (error) {
    console.error('startTelegramLinkAction failed', error)
    return actionError('UNKNOWN', 'Could not start linking. Try again.')
  }
  return actionOk({ code, deepLink: telegramDeepLink(bot, code), expiresAt })
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
  // The bot claims the code (consumed_at) before writing users.telegram_id, so
  // a failure leaves both set — check the failure first.
  if (data.failed_reason)
    return actionOk({ state: 'failed', reason: data.failed_reason })
  if (data.consumed_at) return actionOk({ state: 'linked' })
  if (new Date(data.expires_at).getTime() < Date.now())
    return actionOk({ state: 'expired' })
  return actionOk({ state: 'pending' })
}

export const unlinkTelegramAction = async (): Promise<ActionResult<null>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const service = createServiceRoleClient()
  const { error } = await service
    .from('users')
    .update({ telegram_id: null })
    .eq('clerk_user_id', clerkUserId)
  if (error) {
    console.error('unlinkTelegramAction failed', error)
    return actionError('UNKNOWN', 'Could not unlink. Try again.')
  }
  return actionOk(null)
}
