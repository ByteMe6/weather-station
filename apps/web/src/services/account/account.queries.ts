'use client'

import { useMutation } from '@tanstack/react-query'

import { deleteAccountAction } from '@/actions/account.action'
import { unwrapAction } from '@/lib/actions/unwrap'

/**
 * Erases the caller's data and their Clerk account (server action: service
 * role + Clerk admin API). The caller signs out afterwards, so there is no
 * cache left to invalidate — QueryProvider clears it on the user change.
 */
export const useDeleteAccountMutation = () =>
  useMutation({
    mutationFn: async (input: { confirmation: string }) =>
      unwrapAction(await deleteAccountAction(input)),
  })
