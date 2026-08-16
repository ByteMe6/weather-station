'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import type { DeviceRole } from '@ws/shared'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import { resolveCurrentUserId, resolveMemberRole } from './_helpers'
import { ensureCurrentUserAction } from './users.action'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { normalizeDeviceId } from '@/lib/device-id'
import { parseShareIdentifier } from '@/lib/share-identifier'

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

// ---------------------------------------------------------------------------
// Sharing (MRP-38): owner-only server actions; RLS is bypassed, so every entry
// point resolves the caller's role explicitly.

const ROLES: DeviceRole[] = ['owner', 'editor', 'viewer']
type Service = ReturnType<typeof createServiceRoleClient>

const requireOwner = async (
  deviceId: string,
): Promise<
  | { ok: true; service: Service; userId: string }
  | { ok: false; result: ActionResult<never> }
> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) {
    return {
      ok: false,
      result: actionError('UNAUTHORIZED', 'Sign in to continue'),
    }
  }
  const service = createServiceRoleClient()
  const userId = await resolveCurrentUserId(service, clerkUserId)
  if (!userId) {
    return {
      ok: false,
      result: actionError('UNAUTHORIZED', 'Sign in to continue'),
    }
  }
  const role = await resolveMemberRole(service, userId, deviceId)
  if (role !== 'owner') {
    return {
      ok: false,
      result: actionError('FORBIDDEN', 'Only owners can manage sharing'),
    }
  }
  return { ok: true, service, userId }
}

const IDENT_HELP = 'Enter a Clerk user ID (user_…) or a Telegram ID (digits)'

/** Owner grants access by Clerk user ID or Telegram ID. */
export const shareDeviceAction = async (input: {
  deviceId: string
  identifier: string
  role: DeviceRole
}): Promise<ActionResult<{ userId: string }>> => {
  if (!ROLES.includes(input.role))
    return actionError('INVALID_INPUT', 'Choose a role')
  const ident = parseShareIdentifier(input.identifier)
  if (!ident)
    return actionError('INVALID_INPUT', IDENT_HELP, { identifier: IDENT_HELP })
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const { service } = gate

  const lookup =
    ident.kind === 'clerk'
      ? service
          .from('users')
          .select('id')
          .eq('clerk_user_id', ident.clerkUserId)
          .maybeSingle()
      : service
          .from('users')
          .select('id')
          .eq('telegram_id', ident.telegramId)
          .maybeSingle()
  const { data: target } = await lookup
  if (!target) {
    const msg = 'No account with that ID has signed in yet'
    return actionError('USER_NOT_FOUND', msg, { identifier: msg })
  }

  const { error } = await service
    .from('device_users')
    .insert({ device_id: input.deviceId, user_id: target.id, role: input.role })
  if (error?.code === '23505') {
    const msg = 'That person already has access'
    return actionError('ALREADY_MEMBER', msg, { identifier: msg })
  }
  if (error) {
    console.error('shareDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not share the station. Try again.')
  }
  return actionOk({ userId: target.id })
}

const ownerCount = async (
  service: Service,
  deviceId: string,
): Promise<number> => {
  const { count } = await service
    .from('device_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .eq('role', 'owner')
  return count ?? 0
}

export const updateMemberRoleAction = async (input: {
  deviceId: string
  userId: string
  role: DeviceRole
}): Promise<ActionResult<null>> => {
  if (!ROLES.includes(input.role))
    return actionError('INVALID_INPUT', 'Choose a role')
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const current = await resolveMemberRole(
    gate.service,
    input.userId,
    input.deviceId,
  )
  if (
    current === 'owner' &&
    input.role !== 'owner' &&
    (await ownerCount(gate.service, input.deviceId)) <= 1
  ) {
    return actionError('LAST_OWNER', 'A station needs at least one owner')
  }
  const { error } = await gate.service
    .from('device_users')
    .update({ role: input.role })
    .eq('device_id', input.deviceId)
    .eq('user_id', input.userId)
  if (error) {
    console.error('updateMemberRoleAction failed', error)
    return actionError('UNKNOWN', 'Could not change the role. Try again.')
  }
  return actionOk(null)
}

export const removeMemberAction = async (input: {
  deviceId: string
  userId: string
}): Promise<ActionResult<null>> => {
  const gate = await requireOwner(input.deviceId)
  if (!gate.ok) return gate.result
  const current = await resolveMemberRole(
    gate.service,
    input.userId,
    input.deviceId,
  )
  if (
    current === 'owner' &&
    (await ownerCount(gate.service, input.deviceId)) <= 1
  ) {
    return actionError('LAST_OWNER', 'A station needs at least one owner')
  }
  const { error } = await gate.service
    .from('device_users')
    .delete()
    .eq('device_id', input.deviceId)
    .eq('user_id', input.userId)
  if (error) {
    console.error('removeMemberAction failed', error)
    return actionError('UNKNOWN', 'Could not remove access. Try again.')
  }
  return actionOk(null)
}
