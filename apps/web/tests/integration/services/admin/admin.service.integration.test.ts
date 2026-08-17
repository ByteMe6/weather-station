import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createAdminClient, createUserClient } from '../../helpers/auth-client'

import { fetchAllDevices, fetchAllUsers } from '@/services/admin/admin.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const ADMIN_ORG = 'org_inttest_admin'
const CLERK_ADMIN = 'user_inttest_admin'
const CLERK_PLAIN = 'user_inttest_plain'
const DEVICE_A = 'ws-inttestadmin1'
const DEVICE_B = 'ws-inttestadmin2'

beforeAll(async () => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).',
    )
  }
  const { error } = await db.rpc('set_admin_org_id', { p_org_id: ADMIN_ORG })
  if (error) throw new Error(error.message)
})

afterEach(async () => {
  await db.from('devices').delete().in('device_id', [DEVICE_A, DEVICE_B])
  await db
    .from('users')
    .delete()
    .in('clerk_user_id', [CLERK_ADMIN, CLERK_PLAIN])
})

// The suite repoints the shared Vault secret; restore whatever the developer's
// environment expects so the running app keeps working afterwards.
afterAll(async () => {
  const configured = process.env.ADMIN_ORG_ID
  if (configured) await db.rpc('set_admin_org_id', { p_org_id: configured })
})

describe('admin fleet reads (integration)', () => {
  it('the admin org sees every device and user; a normal user sees only their own', async () => {
    await db.from('users').insert({ clerk_user_id: CLERK_ADMIN })
    const { data: plain } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_PLAIN })
      .select('id')
      .single()
    await db.from('devices').insert([
      { device_id: DEVICE_A, secret: 'a'.repeat(64), status: 'registered' },
      { device_id: DEVICE_B, secret: 'b'.repeat(64), status: 'registered' },
    ])
    await db
      .from('device_users')
      .insert({ device_id: DEVICE_B, user_id: plain!.id, role: 'owner' })

    const asAdmin = createAdminClient(CLERK_ADMIN, ADMIN_ORG)
    const devices = await fetchAllDevices(asAdmin)
    expect(devices.map((d) => d.deviceId)).toEqual(
      expect.arrayContaining([DEVICE_A, DEVICE_B]),
    )
    expect(devices.find((d) => d.deviceId === DEVICE_B)?.memberCount).toBe(1)

    const users = await fetchAllUsers(asAdmin)
    expect(users.map((u) => u.clerkUserId)).toEqual(
      expect.arrayContaining([CLERK_ADMIN, CLERK_PLAIN]),
    )
    expect(users.find((u) => u.id === plain!.id)?.deviceCount).toBe(1)

    // Same code, ordinary session: RLS narrows it to their own rows.
    const asPlain = createUserClient(CLERK_PLAIN)
    expect((await fetchAllDevices(asPlain)).map((d) => d.deviceId)).toEqual([
      DEVICE_B,
    ])
    expect((await fetchAllUsers(asPlain)).map((u) => u.clerkUserId)).toEqual([
      CLERK_PLAIN,
    ])
  })

  it('an admin still cannot read devices.secret', async () => {
    await db.from('users').insert({ clerk_user_id: CLERK_ADMIN })
    await db.from('devices').insert({
      device_id: DEVICE_A,
      secret: 'a'.repeat(64),
      status: 'registered',
    })
    const asAdmin = createAdminClient(CLERK_ADMIN, ADMIN_ORG)
    const { error } = await asAdmin.from('devices').select('secret').limit(1)
    expect(error?.code).toBe('42501')
  })

  it('the vault value matches ADMIN_ORG_ID when the app environment is configured', async () => {
    const configured = process.env.ADMIN_ORG_ID
    if (!configured) return
    await db.rpc('set_admin_org_id', { p_org_id: configured })
    const { data } = await db.rpc('admin_org_id_configured')
    expect(data).toBe(configured)
  })
})
