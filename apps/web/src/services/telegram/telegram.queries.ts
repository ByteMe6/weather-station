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
// deliberately is not: Clerk rotates its session cookie, so a poll landing in
// the refresh window fails and the next one succeeds. (An earlier comment also
// credited EnsureUser with repairing a missing users row — it does not: it is a
// one-shot gate in the (app) layout that has already run by the time this card
// mounts and never re-runs. The failure ceiling below is what bounds that case,
// not a repair.)
const TERMINAL_ERROR_CODES = new Set(['NOT_FOUND'])

// ~1 minute at POLL_MS. Long enough to ride out a deploy or a dropped
// connection, short enough that a hidden tab is not re-issuing a server action
// for the rest of the code's lifetime.
const MAX_CONSECUTIVE_FAILURES = 20

/**
 * Whether the status query should tick again.
 *
 * Order matters: reading the error first meant a settled query that hit a
 * transient failure re-armed the poll indefinitely — a focus refetch of an
 * already-linked code going offline reaches it. A settled state ends the
 * polling whatever else is true.
 *
 * Bounded by consecutive failures rather than by the code's expiry. Judging a
 * server-minted deadline with the browser's clock made a skewed client stop
 * watching a still-redeemable code, and — because the predicate only ever
 * cancels the timer — the poll that would have rendered "Code expired" was
 * cleared before it could run, leaving the card on "Waiting for Telegram… 0:00"
 * instead. The server decides expiry; this only decides when to stop asking.
 */
export const shouldPollLinkStatus = (
  state: TelegramLinkState | undefined,
  error: unknown,
  consecutiveFailures = 0,
): boolean => {
  if (state && state !== 'pending') return false
  if (error) {
    if (error instanceof ActionError && TERMINAL_ERROR_CODES.has(error.code))
      return false
    return consecutiveFailures < MAX_CONSECUTIVE_FAILURES
  }
  return state === 'pending'
}

/**
 * Polls the pending link code through the server action (telegram_link_codes
 * has no client grants, so this read is legitimately on the server path).
 * Stops polling once the state leaves 'pending'.
 */
export const useTelegramLinkStatusQuery = (code: string | null) =>
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
      shouldPollLinkStatus(
        q.state.data?.state,
        q.state.error,
        q.state.fetchFailureCount,
      )
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
