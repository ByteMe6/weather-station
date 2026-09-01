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

// A code that is not ours and a session that is gone cannot start resolving on
// the next tick; a dropped request or a DB blip can.
const TERMINAL_ERROR_CODES = new Set(['NOT_FOUND', 'UNAUTHORIZED'])

/**
 * Whether the status query should tick again.
 *
 * A failed poll used to stop the polling for good - `data` stayed undefined, so
 * the interval read false - while the card went on claiming "retrying". Keeping
 * every error polling fixed that but replaced it with the opposite problem:
 * `retry: false` sends every failure here, so an expired Clerk session polled
 * the server action every three seconds forever, background tabs included. Poll
 * through what can recover, stop on what cannot.
 */
export const shouldPollLinkStatus = (
  state: TelegramLinkState | undefined,
  error: unknown,
): boolean => {
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
      shouldPollLinkStatus(q.state.data?.state, q.state.error)
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
