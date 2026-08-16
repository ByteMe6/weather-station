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
import type { ClerkProfile } from '@/lib/clerk/profiles'
import { fetchClerkProfiles } from '@/lib/clerk/profiles'
import { normalizeDeviceId } from '@/lib/device-id'
import { parseShareIdentifier } from '@/lib/share-identifier'
import { fetchDeviceMemberIdentities } from '@/services/devices/devices.service'

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

const ROLES = [
  'owner',
  'editor',
  'viewer',
] as const satisfies readonly DeviceRole[]
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
  try {
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
  } catch (err) {
    console.error('requireOwner failed', err)
    return { ok: false, result: actionError('UNKNOWN', UNKNOWN_MSG) }
  }
}

const UNKNOWN_MSG = 'Something went wrong. Try again.'
const deviceIdSchema = z.string().min(1).max(64)
const roleSchema = z.enum(ROLES)
const shareSchema = z.object({
  deviceId: deviceIdSchema,
  identifier: z.string().max(200),
  role: roleSchema,
})
const memberSchema = z.object({
  deviceId: deviceIdSchema,
  userId: z.string().uuid(),
})
const memberRoleSchema = memberSchema.extend({ role: roleSchema })

const IDENT_HELP = 'Enter a Clerk user ID (user_…) or a Telegram ID (digits)'

/** Owner grants access by Clerk user ID or Telegram ID. */
export const shareDeviceAction = async (input: {
  deviceId: string
  identifier: string
  role: DeviceRole
}): Promise<ActionResult<{ userId: string }>> => {
  const parsed = shareSchema.safeParse(input)
  if (!parsed.success)
    return actionError('INVALID_INPUT', IDENT_HELP, { identifier: IDENT_HELP })
  const ident = parseShareIdentifier(parsed.data.identifier)
  if (!ident)
    return actionError('INVALID_INPUT', IDENT_HELP, { identifier: IDENT_HELP })
  const { deviceId, role } = parsed.data
  const gate = await requireOwner(deviceId)
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
  const { data: target, error: lookupError } = await lookup
  if (lookupError) {
    console.error('shareDeviceAction lookup failed', lookupError)
    return actionError('UNKNOWN', 'Could not share the station. Try again.')
  }
  if (!target) {
    const msg = 'No account with that ID has signed in yet'
    return actionError('USER_NOT_FOUND', msg, { identifier: msg })
  }

  const { error } = await service
    .from('device_users')
    .insert({ device_id: deviceId, user_id: target.id, role })
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
  const { count, error } = await service
    .from('device_users')
    .select('user_id', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .eq('role', 'owner')
  if (error) throw error
  return count ?? 0
}

export const updateMemberRoleAction = async (input: {
  deviceId: string
  userId: string
  role: DeviceRole
}): Promise<ActionResult<null>> => {
  const parsed = memberRoleSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Choose a role')
  const { deviceId, userId, role } = parsed.data
  const gate = await requireOwner(deviceId)
  if (!gate.ok) return gate.result
  try {
    const current = await resolveMemberRole(gate.service, userId, deviceId)
    if (
      current === 'owner' &&
      role !== 'owner' &&
      (await ownerCount(gate.service, deviceId)) <= 1
    ) {
      return actionError('LAST_OWNER', 'A station needs at least one owner')
    }
    const { error } = await gate.service
      .from('device_users')
      .update({ role })
      .eq('device_id', deviceId)
      .eq('user_id', userId)
    if (error) throw error
  } catch (err) {
    console.error('updateMemberRoleAction failed', err)
    return actionError('UNKNOWN', 'Could not change the role. Try again.')
  }
  return actionOk(null)
}

export const removeMemberAction = async (input: {
  deviceId: string
  userId: string
}): Promise<ActionResult<null>> => {
  const parsed = memberSchema.safeParse(input)
  if (!parsed.success)
    return actionError('INVALID_INPUT', 'That member could not be found')
  const { deviceId, userId } = parsed.data
  const gate = await requireOwner(deviceId)
  if (!gate.ok) return gate.result
  try {
    const current = await resolveMemberRole(gate.service, userId, deviceId)
    if (
      current === 'owner' &&
      (await ownerCount(gate.service, deviceId)) <= 1
    ) {
      return actionError('LAST_OWNER', 'A station needs at least one owner')
    }
    const { error } = await gate.service
      .from('device_users')
      .delete()
      .eq('device_id', deviceId)
      .eq('user_id', userId)
    if (error) throw error
  } catch (err) {
    console.error('removeMemberAction failed', err)
    return actionError('UNKNOWN', 'Could not remove access. Try again.')
  }
  return actionOk(null)
}

const profileSchema = z.object({
  deviceId: z.string().min(1),
  label: z
    .string()
    .trim()
    .max(40, 'Keep the nickname under 40 characters')
    .transform((v) => (v.length === 0 ? null : v)),
  address: z
    .string()
    .trim()
    .max(200, 'Keep the address under 200 characters')
    .transform((v) => (v.length === 0 ? null : v)),
})

/** Owner sets the station's nickname and address (free text; geocoding/map is a later ticket). */
export const updateDeviceProfileAction = async (input: {
  deviceId: string
  label: string
  address: string
}): Promise<ActionResult<{ label: string | null; address: string | null }>> => {
  const parsed = profileSchema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'label')
      fieldErrors[key] = issue.message
    }
    return actionError(
      'INVALID_INPUT',
      'Check the highlighted fields',
      fieldErrors,
    )
  }
  const gate = await requireOwner(parsed.data.deviceId)
  if (!gate.ok) return gate.result
  const { error } = await gate.service
    .from('devices')
    .update({ label: parsed.data.label, address: parsed.data.address })
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('updateDeviceProfileAction failed', error)
    return actionError(
      'UNKNOWN',
      'Could not save the station details. Try again.',
    )
  }
  return actionOk({ label: parsed.data.label, address: parsed.data.address })
}

export type MemberProfiles = Record<string, ClerkProfile>

const profilesSchema = z.object({ deviceId: deviceIdSchema })

/**
 * Display names/avatars for the members the caller may see (owner: everyone,
 * other members: themselves), keyed by internal users.id. Resolved live from
 * Clerk on the server — the browser never receives a Clerk id, and nothing is
 * stored. Telegram-only members have no Clerk profile and are simply absent.
 */
export const getDeviceMemberProfilesAction = async (input: {
  deviceId: string
}): Promise<ActionResult<MemberProfiles>> => {
  const { userId: clerkUserId } = await auth()
  if (!clerkUserId) return actionError('UNAUTHORIZED', 'Sign in to continue')
  const parsed = profilesSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown station')
  const { deviceId } = parsed.data
  const service = createServiceRoleClient()
  try {
    const userId = await resolveCurrentUserId(service, clerkUserId)
    if (!userId) return actionError('UNAUTHORIZED', 'Sign in to continue')
    const role = await resolveMemberRole(service, userId, deviceId)
    if (!role)
      return actionError('FORBIDDEN', "You don't have access to this station")
    const identities = await fetchDeviceMemberIdentities(service, { deviceId })
    const visible =
      role === 'owner'
        ? identities
        : identities.filter((m) => m.userId === userId)
    const profiles = await fetchClerkProfiles(
      visible.flatMap((m) => (m.clerkUserId ? [m.clerkUserId] : [])),
    )
    const out: MemberProfiles = {}
    for (const m of visible) {
      const profile = m.clerkUserId ? profiles.get(m.clerkUserId) : undefined
      if (profile) out[m.userId] = profile
    }
    return actionOk(out)
  } catch (err) {
    console.error('getDeviceMemberProfilesAction failed', err)
    return actionError('UNKNOWN', 'Could not load member names')
  }
}
