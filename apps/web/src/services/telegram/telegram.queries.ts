'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getTelegramLinkStatusAction,
  startTelegramLinkAction,
  unlinkTelegramAction,
} from '@/actions/telegram.action'
import { unwrapAction } from '@/lib/actions/unwrap'
import { userKeys } from '@/services/users/users.queries'

export const telegramKeys = {
  all: ['telegram'] as const,
  linkStatus: (code: string | null) =>
    [...telegramKeys.all, 'link-status', code] as const,
}

const POLL_MS = 3_000

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
    refetchInterval: (q) => {
      // A failed poll used to stop polling for good — `data` stayed undefined,
      // so this returned false — while the card went on claiming "retrying".
      // The link the user is waiting on is still in flight, so keep asking.
      if (q.state.status === 'error') return POLL_MS
      return q.state.data?.state === 'pending' ? POLL_MS : false
    },
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
