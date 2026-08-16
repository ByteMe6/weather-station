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
import { adminOrgId, isAdminOrg } from '@/lib/admin/org'

export type AdminStatus =
  | { state: 'ok'; configMismatch: boolean }
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
  const { userId, orgId } = await auth()
  if (!userId || !isAdminOrg(orgId)) {
    return { ok: false, result: actionError('NOT_FOUND', DENIED) }
  }
  return { ok: true }
}

/** The value RLS uses, read back through the service role for the drift check. */
const vaultAdminOrgId = async (): Promise<string | null> => {
  const { data, error } = await createServiceRoleClient().rpc(
    'admin_org_id_configured',
  )
  if (error) return null
  return typeof data === 'string' ? data : null
}

export const getAdminStatusAction = async (): Promise<
  ActionResult<AdminStatus>
> => {
  const { userId, orgId } = await auth()
  if (!userId) return actionOk({ state: 'denied' })

  const configured = adminOrgId()
  if (!configured) return actionOk({ state: 'denied' })

  if (orgId === configured) {
    const fromVault = await vaultAdminOrgId()
    return actionOk({ state: 'ok', configMismatch: fromVault !== configured })
  }

  // The active organisation is not the admin one — but membership is what
  // decides whether this user may activate it.
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
  const { error } = await createServiceRoleClient()
    .from('devices')
    .update({ secret })
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('rotateDeviceSecretAction failed', error)
    return actionError('UNKNOWN', 'Could not rotate the secret. Try again.')
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

  const { error } = await createServiceRoleClient()
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

  const { error } = await createServiceRoleClient()
    .from('devices')
    .delete()
    .eq('device_id', parsed.data.deviceId)
  if (error) {
    console.error('deleteDeviceAction failed', error)
    return actionError('UNKNOWN', 'Could not delete the device. Try again.')
  }
  return actionOk(null)
}
