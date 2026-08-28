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
import { findClerkUserIdByEmail } from '@/lib/clerk/lookup'
import type { ClerkProfile } from '@/lib/clerk/profiles'
import { fetchClerkProfiles } from '@/lib/clerk/profiles'
import { normalizeDeviceId } from '@/lib/device-id'
import type { ShareIdentifier } from '@/lib/share-identifier'
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
  // The commonest way to hit this is not someone else's station: it is your
  // own, registered earlier through the Telegram bot, which created a separate
  // telegram-only account. Linking Telegram in Settings merges the two and
  // brings the station across, so the message has to name that route — saying
  // only "another account" sent people to a dead end that was factually wrong
  // about their own device.
  DEVICE_ALREADY_CLAIMED:
    'This station is already registered. If you added it from the Telegram bot, link Telegram in Settings to bring it across.',
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

const IDENT_HELP = 'Enter their email address, or their Telegram ID (digits)'
const SHARE_UNKNOWN_MSG = 'Could not share the station. Try again.'

const notFound = (msg: string): { ok: false; result: ActionResult<never> } => ({
  ok: false,
  result: actionError('USER_NOT_FOUND', msg, { identifier: msg }),
})

/**
 * Internal `users.id` for the person an owner named, or an ActionResult
 * saying why we could not name exactly one account.
 *
 * The email branch upserts where the Telegram branch selects: `users` rows are
 * created lazily on first dashboard visit (`ensureCurrentUserAction`), so
 * someone who signed up but never opened the app has no row yet — refusing
 * them would read as "your colleague has no account" when they plainly do.
 * Telegram ids stay select-only; only the bot may mint those rows.
 */
const resolveShareTarget = async (
  service: Service,
  ident: ShareIdentifier,
): Promise<
  { ok: true; userId: string } | { ok: false; result: ActionResult<never> }
> => {
  if (ident.kind === 'telegram') {
    const { data, error } = await service
      .from('users')
      .select('id')
      .eq('telegram_id', ident.telegramId)
      .maybeSingle()
    if (error) {
      console.error('shareDeviceAction telegram lookup failed', error)
      return { ok: false, result: actionError('UNKNOWN', SHARE_UNKNOWN_MSG) }
    }
    if (!data)
      return notFound('No account with that Telegram ID has used the bot yet')
    return { ok: true, userId: data.id }
  }

  let clerkUserId: string | null
  try {
    clerkUserId = await findClerkUserIdByEmail(ident.email)
  } catch (err) {
    // Clerk is the only place emails live, so an outage here is not a miss.
    console.error('shareDeviceAction email lookup failed', err)
    return { ok: false, result: actionError('UNKNOWN', SHARE_UNKNOWN_MSG) }
  }
  if (!clerkUserId)
    return notFound('No Weather Station account uses that email yet')

  const { data, error } = await service
    .from('users')
    .upsert(
      { clerk_user_id: clerkUserId },
      { onConflict: 'clerk_user_id', ignoreDuplicates: false },
    )
    .select('id')
    .single()
  if (error || !data) {
    console.error('shareDeviceAction users upsert failed', error)
    return { ok: false, result: actionError('UNKNOWN', SHARE_UNKNOWN_MSG) }
  }
  return { ok: true, userId: data.id }
}

/** Owner grants access by sign-in email or Telegram ID (MRP-38). */
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

  const target = await resolveShareTarget(service, ident)
  if (!target.ok) return target.result

  const { error } = await service
    .from('device_users')
    .insert({ device_id: deviceId, user_id: target.userId, role })
  if (error?.code === '23505') {
    const msg = 'That person already has access'
    return actionError('ALREADY_MEMBER', msg, { identifier: msg })
  }
  if (error) {
    console.error('shareDeviceAction failed', error)
    return actionError('UNKNOWN', SHARE_UNKNOWN_MSG)
  }
  return actionOk({ userId: target.userId })
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
    const { data, error } = await gate.service
      .from('device_users')
      .update({ role })
      .eq('device_id', deviceId)
      .eq('user_id', userId)
      .select('user_id')
    if (error) throw error
    // Zero rows means the membership vanished (removed in another tab); saying
    // "Role updated" for a write that touched nothing is a lie.
    if ((data ?? []).length !== 1) {
      return actionError('NOT_A_MEMBER', 'That person no longer has access')
    }
  } catch (err) {
    // The device_users_owner_guard trigger is the race-proof backstop for the
    // app-level check above: two owners demoting each other concurrently both
    // passed that check before the invariant moved into the database.
    if (err instanceof Error && err.message.includes('DEVICE_NEEDS_OWNER')) {
      return actionError('LAST_OWNER', 'A station needs at least one owner')
    }
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
    const { data, error } = await gate.service
      .from('device_users')
      .delete()
      .eq('device_id', deviceId)
      .eq('user_id', userId)
      .select('user_id')
    if (error) throw error
    if ((data ?? []).length !== 1) {
      return actionError('NOT_A_MEMBER', 'That person no longer has access')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('DEVICE_NEEDS_OWNER')) {
      return actionError('LAST_OWNER', 'A station needs at least one owner')
    }
    console.error('removeMemberAction failed', err)
    return actionError('UNKNOWN', 'Could not remove access. Try again.')
  }
  return actionOk(null)
}

// Empty string clears the value; anything else must be a number in range. The
// DB enforces both-or-neither too (devices_coords_both_or_neither), but doing
// it here turns a 23514 into a field error the form can point at.
const coordinateField = (min: number, max: number, name: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? null : v))
    .refine((v) => v === null || /^-?\d+(\.\d+)?$/.test(v), {
      message: `Enter ${name} as a decimal number`,
    })
    .transform((v) => (v === null ? null : Number(v)))
    .refine((v) => v === null || (v >= min && v <= max), {
      message: `${name} must be between ${min} and ${max}`,
    })

const profileSchema = z
  .object({
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
    latitude: coordinateField(-90, 90, 'latitude'),
    longitude: coordinateField(-180, 180, 'longitude'),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude === null) === (v.longitude === null)) return
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [v.latitude === null ? 'latitude' : 'longitude'],
      message: 'Enter both latitude and longitude, or leave both empty',
    })
  })

/** Owner sets the station's nickname and address (free text; geocoding/map is a later ticket). */
export const updateDeviceProfileAction = async (input: {
  deviceId: string
  label: string
  address: string
  latitude: string
  longitude: string
}): Promise<
  ActionResult<{
    label: string | null
    address: string | null
    latitude: number | null
    longitude: number | null
  }>
> => {
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
  // Return the row the database actually holds rather than echoing the input:
  // a zero-row update reports no error, so echoing would show values that were
  // never stored.
  const { data, error } = await gate.service
    .from('devices')
    .update({
      label: parsed.data.label,
      address: parsed.data.address,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
    })
    .eq('device_id', parsed.data.deviceId)
    .select('label, address, latitude, longitude')
    .maybeSingle()
  if (error) {
    console.error('updateDeviceProfileAction failed', error)
    return actionError(
      'UNKNOWN',
      'Could not save the station details. Try again.',
    )
  }
  if (!data) {
    return actionError('DEVICE_NOT_FOUND', 'That station no longer exists')
  }
  return actionOk(data)
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
