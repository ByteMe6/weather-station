'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { ensureCurrentUserAction } from './users.action'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { normalizeDeviceId } from '@/lib/device-id'

const inputSchema = z.object({
  deviceId: z
    .string()
    .transform(normalizeDeviceId)
    .pipe(z.string().min(3).max(64)),
})

const MESSAGES = {
  DEVICE_NOT_FOUND: "We don't recognise that ID — check the label",
  DEVICE_ALREADY_CLAIMED: 'This station is already linked to another account',
} as const

/**
 * Web device registration (PRD W2/B2, MRP-22): validate → ensure users row →
 * claim_device() RPC (atomic; owner link + status flip). Idempotent per user.
 */
export const registerDeviceAction = async (input: {
  deviceId: string
}): Promise<ActionResult<{ deviceId: string }>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return actionError(
      'INVALID_INPUT',
      'Enter the ID printed on your station',
      { deviceId: 'Enter the ID printed on your station' },
    )
  }
  const deviceId = parsed.data.deviceId

  const ensured = await ensureCurrentUserAction()
  if (!ensured.ok) return actionError(ensured.code, ensured.message)

  const service = createServiceRoleClient()
  const { error } = await service.rpc('claim_device', {
    p_device_id: deviceId,
    p_user_id: ensured.data.userId,
  })

  if (error) {
    if (error.message.includes('DEVICE_NOT_FOUND')) {
      return actionError('DEVICE_NOT_FOUND', MESSAGES.DEVICE_NOT_FOUND, {
        deviceId: MESSAGES.DEVICE_NOT_FOUND,
      })
    }
    if (error.message.includes('DEVICE_ALREADY_CLAIMED')) {
      return actionError(
        'DEVICE_ALREADY_CLAIMED',
        MESSAGES.DEVICE_ALREADY_CLAIMED,
        { deviceId: MESSAGES.DEVICE_ALREADY_CLAIMED },
      )
    }
    console.error('registerDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not register the station. Try again.')
  }
  return actionOk({ deviceId })
}
