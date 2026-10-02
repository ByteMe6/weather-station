'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiKeyScope } from '@ws/shared'

import {
  createApiKeyAction,
  listApiKeysAction,
  revokeApiKeyAction,
} from '@/actions/api-keys.action'
import { unwrapAction } from '@/lib/actions/unwrap'

export const apiKeyKeys = {
  all: ['api-keys'] as const,
  list: () => [...apiKeyKeys.all, 'list'] as const,
}

/** Server path: keys live behind the service role (no client grant on api_keys). */
export const useApiKeysQuery = (enabled: boolean) =>
  useQuery({
    queryKey: apiKeyKeys.list(),
    queryFn: async () => unwrapAction(await listApiKeysAction()),
    enabled,
  })

export const useCreateApiKeyMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      scope: ApiKeyScope
      expiresInDays: number | null
    }) => unwrapAction(await createApiKeyAction(input)),
    // The result carries the one-time secret: drop it from the mutation cache
    // as soon as nothing observes it instead of keeping it for the default 5 min.
    gcTime: 0,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  })
}

export const useRevokeApiKeyMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { keyId: string }) =>
      unwrapAction(await revokeApiKeyAction(input)),
    // onSettled, not onSuccess: a NOT_FOUND (revoked elsewhere) is exactly when
    // the list is stale and must be refetched, or the dead row stays on screen.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.all }),
  })
}
