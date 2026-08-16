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
    queryFn: () => getTelegramLinkStatusAction({ code: code! }),
    enabled: code !== null,
    // Keep polling while the user is over in the Telegram app / another window.
    refetchIntervalInBackground: true,
    refetchInterval: (q) => {
      const d = q.state.data
      return d && d.ok && d.data.state === 'pending' ? POLL_MS : false
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
