'use server'

import 'server-only'

import { auth, clerkClient } from '@clerk/nextjs/server'
import {
  generateDeviceId,
  generateDeviceSecret,
} from '@ws/shared/device-identity'
import { createServiceRoleClient } from '@ws/supabase-db'
import { z } from 'zod'

import type { ActionResult } from '@/lib/actions/result'
import { actionError, actionOk } from '@/lib/actions/result'
import { isAdminRequest } from '@/lib/admin/access'
import { adminOrgId } from '@/lib/admin/org'

export type AdminStatus =
  | { state: 'ok'; configMismatch: boolean; configUnavailable: boolean }
  | { state: 'needs-activation'; orgId: string }
  | { state: 'denied' }

// A non-admin must not learn that the console exists, so every refusal is the
// same NOT_FOUND the UI turns into a 404 — never a distinguishable 403.
const DENIED = 'Not found'
const deviceIdSchema = z.object({ deviceId: z.string().min(3).max(64) })

/** Layer 3 of the gate: re-derived per call, never inherited from the page. */
const requireAdmin = async (): Promise<
  { ok: true } | { ok: false; result: ActionResult<never> }
> => {
  if (!(await isAdminRequest())) {
    return { ok: false, result: actionError('NOT_FOUND', DENIED) }
  }
  return { ok: true }
}

type VaultOrgId =
  { kind: 'value'; value: string } | { kind: 'unset' } | { kind: 'unavailable' }

/**
 * The value RLS uses, read back through the service role for the drift check.
 * A failed RPC is NOT the same as a differing value: collapsing them made the
 * console tell the operator to run `admin:set-org` when the real fault was an
 * unreachable vault.
 */
const vaultAdminOrgId = async (): Promise<VaultOrgId> => {
  const { data, error } = await createServiceRoleClient().rpc(
    'admin_org_id_configured',
  )
  if (error) {
    console.error('vaultAdminOrgId: RPC failed', error)
    return { kind: 'unavailable' }
  }
  return typeof data === 'string' && data.length > 0
    ? { kind: 'value', value: data }
    : { kind: 'unset' }
}

export const getAdminStatusAction = async (): Promise<
  ActionResult<AdminStatus>
> => {
  const { userId, orgId } = await auth()
  if (!userId) return actionOk({ state: 'denied' })

  const configured = adminOrgId()
  if (!configured) return actionOk({ state: 'denied' })

  // Active organisation matching is the happy path; membership still counts,
  // because the server's cookie token can lag behind the client's.
  if (orgId === configured) {
    const fromVault = await vaultAdminOrgId()
    return actionOk({
      state: 'ok',
      // Only a value we actually read and that differs is drift.
      configMismatch:
        fromVault.kind === 'unset' ||
        (fromVault.kind === 'value' && fromVault.value !== configured),
      configUnavailable: fromVault.kind === 'unavailable',
    })
  }

  // Not active here — but membership decides whether this user may activate it.
  try {
    const client = await clerkClient()
    const memberships = await client.users.getOrganizationMembershipList({
      userId,
      limit: 100,
    })
    const isMember = memberships.data.some(
      (m) => m.organization.id === configured,
    )
    return actionOk(
      isMember
        ? { state: 'needs-activation', orgId: configured }
        : { state: 'denied' },
    )
  } catch (err) {
    console.error('getAdminStatusAction: membership lookup failed', err)
    return actionOk({ state: 'denied' })
  }
}

const MAX_ID_ATTEMPTS = 5

export const createDeviceAction = async (): Promise<
  ActionResult<{ deviceId: string; secret: string }>
> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result

  const service = createServiceRoleClient()
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const deviceId = generateDeviceId()
    const secret = generateDeviceSecret()
    const { error } = await service
      .from('devices')
      .insert({ device_id: deviceId, secret, status: 'unregistered' })
    if (!error) return actionOk({ deviceId, secret })
    // 23505 is a device_id collision — vanishingly unlikely, cheap to retry.
    if (error.code !== '23505') {
      console.error('createDeviceAction failed', error)
      return actionError('UNKNOWN', 'Could not create the device. Try again.')
    }
  }
  return actionError('UNKNOWN', 'Could not mint a unique device id. Try again.')
}

export const rotateDeviceSecretAction = async (input: {
  deviceId: string
}): Promise<ActionResult<{ secret: string }>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown device')

  const secret = generateDeviceSecret()
  // `.select()` is load-bearing: PostgREST reports no error when an update
  // matches zero rows, so without it a deleted or mistyped device id returned
  // a freshly minted secret that was never stored — the admin flashes it and
  // the station 401s forever, with the real secret unrecoverable by design.
  const { data, error } = await createServiceRoleClient()
    .from('devices')
    .update({ secret })
    .eq('device_id', parsed.data.deviceId)
    .select('device_id')
  if (error) {
    console.error('rotateDeviceSecretAction failed', error)
    return actionError('UNKNOWN', 'Could not rotate the secret. Try again.')
  }
  if ((data ?? []).length !== 1) {
    return actionError(
      'DEVICE_NOT_FOUND',
      'That device no longer exists — refresh the fleet list.',
    )
  }
  return actionOk({ secret })
}

/**
 * Drops every membership so the device_users_after_delete trigger flips the
 * device back to 'unregistered' and it can be claimed again. The device row
 * and its readings survive.
 */
export const unclaimDeviceAction = async (input: {
  deviceId: string
}): Promise<ActionResult<null>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema.safeParse(input)
  if (!parsed.success) return actionError('INVALID_INPUT', 'Unknown device')

  const service = createServiceRoleClient()
  const { data: device, error: lookupError } = await service
    .from('devices')
    .select('device_id')
    .eq('device_id', parsed.data.deviceId)
    .maybeSingle()
  if (lookupError) {
    console.error('unclaimDeviceAction lookup failed', lookupError)
    return actionError('UNKNOWN', 'Could not unclaim the device. Try again.')
  }
  if (!device) {
    return actionError(
      'DEVICE_NOT_FOUND',
      'That device no longer exists — refresh the fleet list.',
    )
  }

  // A device with no members is already unclaimed, so zero deleted rows is a
  // legitimate no-op here — unlike rotate, nothing is handed back to the user.
  const { error } = await service
    .from('device_users')
    .delete()
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('unclaimDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not unclaim the device. Try again.')
  }
  return actionOk(null)
}

/** Destroys the device and, by cascade, its readings. Confirmation is the id. */
export const deleteDeviceAction = async (input: {
  deviceId: string
  confirmation: string
}): Promise<ActionResult<null>> => {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.result
  const parsed = deviceIdSchema
    .extend({ confirmation: z.string() })
    .safeParse(input)
  if (
    !parsed.success ||
    parsed.data.confirmation.trim() !== parsed.data.deviceId
  ) {
    return actionError('INVALID_INPUT', 'Type the device id to confirm', {
      confirmation: 'Type the device id to confirm',
    })
  }

  const { data, error } = await createServiceRoleClient()
    .from('devices')
    .delete()
    .eq('device_id', parsed.data.deviceId)
    .select('device_id')
  if (error) {
    console.error('deleteDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not delete the device. Try again.')
  }
  if ((data ?? []).length !== 1) {
    return actionError(
      'DEVICE_NOT_FOUND',
      'That device no longer exists — refresh the fleet list.',
    )
  }
  return actionOk(null)
}
