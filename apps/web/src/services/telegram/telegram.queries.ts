'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TelegramLinkState } from '@/actions/telegram.action'
import {
  getTelegramLinkStatusAction,
  startTelegramLinkAction,
  unlinkTelegramAction,
} from '@/actions/telegram.action'
import { ActionError, unwrapAction } from '@/lib/actions/unwrap'
import { userKeys } from '@/services/users/users.queries'

export const telegramKeys = {
  all: ['telegram'] as const,
  linkStatus: (code: string | null) =>
    [...telegramKeys.all, 'link-status', code] as const,
}

const POLL_MS = 3_000

// NOT_FOUND is the only failure here that cannot resolve itself. UNAUTHORIZED
// deliberately is not: Clerk rotates its session cookie, and resolveCurrentUserId
// returns null whenever the users row is briefly absent (EnsureUser repairs it) —
// both map to UNAUTHORIZED and both succeed on the next tick.
const TERMINAL_ERROR_CODES = new Set(['NOT_FOUND'])

/**
 * Whether the status query should tick again.
 *
 * Order matters. Reading the error first meant a settled query that hit a
 * transient failure — a focus refetch of an already-linked code going offline —
 * re-armed the 3s background poll indefinitely, which is the loop this is meant
 * to bound. A settled state ends the polling whatever else is true.
 *
 * The code's own expiry is the backstop: naming terminal error codes only
 * covers the failures we can name, so a Supabase outage would otherwise poll
 * for hours after the code stopped being redeemable.
 */
export const shouldPollLinkStatus = (
  state: TelegramLinkState | undefined,
  error: unknown,
  expiresAt?: string | null,
): boolean => {
  if (state && state !== 'pending') return false
  if (expiresAt) {
    const deadline = Date.parse(expiresAt)
    if (Number.isFinite(deadline) && deadline < Date.now()) return false
  }
  if (error)
    return !(
      error instanceof ActionError && TERMINAL_ERROR_CODES.has(error.code)
    )
  return state === 'pending'
}

/**
 * Polls the pending link code through the server action (telegram_link_codes
 * has no client grants, so this read is legitimately on the server path).
 * Stops polling once the state leaves 'pending'.
 */
export const useTelegramLinkStatusQuery = (
  code: string | null,
  expiresAt?: string | null,
) =>
  useQuery({
    queryKey: telegramKeys.linkStatus(code),
    // Unwraps like every other hook: returning the raw ActionResult left
    // `isError` permanently false, so one failed poll froze the card on
    // "Waiting for Telegram…" with no error and no further polling.
    queryFn: async () =>
      unwrapAction(await getTelegramLinkStatusAction({ code: code! })),
    enabled: code !== null,
    retry: false,
    // Keep polling while the user is over in the Telegram app / another window.
    refetchIntervalInBackground: true,
    refetchInterval: (q) =>
      shouldPollLinkStatus(q.state.data?.state, q.state.error, expiresAt)
        ? POLL_MS
        : false,
  })

/** Mints a link code + deep link; the card then polls `useTelegramLinkStatusQuery`. */
export const useStartTelegramLinkMutation = () =>
  useMutation({
    mutationFn: async () => unwrapAction(await startTelegramLinkAction()),
  })

export const useUnlinkTelegramMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrapAction(await unlinkTelegramAction()),
    // The linked state is derived from users.telegramId, so refresh that row.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: userKeys.current }),
  })
}
