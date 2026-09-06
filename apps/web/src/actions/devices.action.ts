'use server'

import 'server-only'

import { auth } from '@clerk/nextjs/server'
import type { DeviceRole } from '@ws/shared'
import { canEditDeviceProfile, canManageDeviceMembers } from '@ws/shared'
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
// Sharing (MRP-38) and station details (MRP-48). RLS is bypassed here, so every
// entry point resolves the caller's role explicitly — membership changes stay
// owner-only, station details are open to editors.

const ROLES = [
  'owner',
  'editor',
  'viewer',
] as const satisfies readonly DeviceRole[]
type Service = ReturnType<typeof createServiceRoleClient>

type Gate =
  | { ok: true; service: Service; userId: string; role: DeviceRole }
  | { ok: false; result: ActionResult<never> }

/**
 * Resolve the caller and assert their role on the device is one of `allowed`.
 *
 * RLS is bypassed on this path, so every entry point has to check membership in
 * code. The predicate comes from @ws/shared, shared with the components that
 * render the corresponding control: two independent copies of the same
 * condition is how `editor` became a label the UI offered that granted nothing.
 * `forbidden` is passed in because a shared message would have to be vague
 * enough to fit both authorities, and "Only owners can manage sharing" is the
 * sentence that tells someone what to do next.
 */
const requireRole = async (
  deviceId: string,
  allows: (role: DeviceRole) => boolean,
  forbidden: string,
): Promise<Gate> => {
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
    if (!role || !allows(role)) {
      return { ok: false, result: actionError('FORBIDDEN', forbidden) }
    }
    return { ok: true, service, userId, role }
  } catch (err) {
    console.error('requireRole failed', err)
    return { ok: false, result: actionError('UNKNOWN', UNKNOWN_MSG) }
  }
}

/** Membership changes — sharing, role changes, removals — are owner-only. */
const requireOwner = async (deviceId: string): Promise<Gate> =>
  requireRole(
    deviceId,
    canManageDeviceMembers,
    'Only owners can manage sharing',
  )

/** Station details. Open to editors — see canEditDeviceProfile for why. */
const requireProfileEditor = async (deviceId: string): Promise<Gate> =>
  requireRole(
    deviceId,
    canEditDeviceProfile,
    'Only owners and editors can edit this station',
  )

/** Any member; the caller then branches on `gate.role` for what they may see. */
const requireMember = async (deviceId: string): Promise<Gate> =>
  requireRole(deviceId, () => true, "You don't have access to this station")

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

/** Owners and editors set the station's nickname, address and coordinates. */
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
  const gate = await requireProfileEditor(parsed.data.deviceId)
  if (!gate.ok) return gate.result
  // Through update_device_profile(), not a direct UPDATE: the function
  // re-checks membership in SQL, so this authority has a database-side backstop
  // the way membership writes have device_users_owner_guard. The gate above is
  // still what produces the user-facing refusal; this is the layer that holds
  // if the gate is ever wrong.
  //
  // Returns the row the database actually holds rather than echoing the input,
  // so a write that stored nothing cannot be reported as success.
  const { data, error } = await gate.service.rpc('update_device_profile', {
    p_device_id: parsed.data.deviceId,
    p_user_id: gate.userId,
    // `?? undefined`, not null: the generated Args type cannot express a
    // nullable argument, so the four clearable fields are defaulted in SQL and
    // omitting the key is how null is sent. Same stored result either way.
    p_label: parsed.data.label ?? undefined,
    p_address: parsed.data.address ?? undefined,
    p_latitude: parsed.data.latitude ?? undefined,
    p_longitude: parsed.data.longitude ?? undefined,
  })
  if (error) {
    // Matched on the SQL error code plus the exact token, not a substring of
    // the message: the function sets `using errcode = 'P0001'`, and matching
    // loosely would let a renamed token silently downgrade a real authority
    // refusal to UNKNOWN.
    if (
      error.code === 'P0001' &&
      error.message === 'DEVICE_PROFILE_FORBIDDEN'
    ) {
      // Fires only when the TypeScript gate and the SQL check reached opposite
      // conclusions — the anomaly this whole path exists to detect. Both the id
      // that was passed and the role the gate believed are needed to tell a
      // wrong user from a stale role from a drifted SQL list; deviceId alone
      // leaves reproducing it as the only way to find out. userId is the
      // internal uuid, so no Clerk identifier leaks into the log.
      console.error('updateDeviceProfileAction: gate and RPC disagree', {
        deviceId: parsed.data.deviceId,
        userId: gate.userId,
        role: gate.role,
      })
      return actionError(
        'FORBIDDEN',
        'Only owners and editors can edit this station',
      )
    }
    console.error('updateDeviceProfileAction failed', error)
    return actionError(
      'UNKNOWN',
      'Could not save the station details. Try again.',
    )
  }
  // rpc() rows cannot be aliased in the query string (CLAUDE.md), so the
  // out_-prefixed columns are mapped here.
  const row = data?.[0]
  // Defensive, and unreachable today: device_users.device_id cascades on
  // delete, so a caller that passed the membership check cannot then find the
  // devices row gone. Kept because "the write proves it hit a row" is the rule,
  // not because this branch has a known trigger.
  if (!row) {
    return actionError('DEVICE_NOT_FOUND', 'That station no longer exists')
  }
  // `?? null` is not redundant. `supabase gen types` cannot infer nullability
  // for RETURNS TABLE, so all four arrive typed non-null while every one of
  // them is nullable in the database — a station with a cleared nickname
  // returns null. Without this, `row.out_label.trim()` would typecheck here and
  // throw at runtime; the `.select()` this replaced produced correct types from
  // the table definition.
  return actionOk({
    label: row.out_label ?? null,
    address: row.out_address ?? null,
    latitude: row.out_latitude ?? null,
    longitude: row.out_longitude ?? null,
  })
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
  const parsed = profilesSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown station')
  const { deviceId } = parsed.data
  // Through the same gate as every other entry point. This used to re-implement
  // auth() -> resolveCurrentUserId -> resolveMemberRole -> error mapping inline,
  // so a later change to how membership is resolved (a suspended-account check,
  // say) would have silently skipped this action alone.
  const gate = await requireMember(deviceId)
  if (!gate.ok) return gate.result
  const { service, userId } = gate
  try {
    const identities = await fetchDeviceMemberIdentities(service, { deviceId })
    const visible = canManageDeviceMembers(gate.role)
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
