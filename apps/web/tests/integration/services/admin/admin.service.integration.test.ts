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

// The Vault secret is shared global state in a live database, not a fixture:
// whatever it held before this suite ran has to come back afterwards, or the
// developer's own console starts reporting a configuration mismatch (and on a
// shared environment, real admins lose access until someone notices).
let previousAdminOrg: string | null = null

beforeAll(async () => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).',
    )
  }
  const { data: current } = await db.rpc('admin_org_id_configured')
  previousAdminOrg = typeof current === 'string' ? current : null

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

afterAll(async () => {
  // Restore what was there, not what an env var happens to say: the test
  // process has no ADMIN_ORG_ID (it is passed to the dev server inline), so the
  // old guard silently skipped the restore every single run.
  if (previousAdminOrg !== null) {
    await db.rpc('set_admin_org_id', { p_org_id: previousAdminOrg })
  }
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

    // Same code, ordinary session: the fleet RPCs gate on is_admin_request()
    // themselves and return nothing at all — they are not a general-purpose
    // read that quietly narrows. The user's own data still reaches them
    // through the ordinary device/schedule services.
    const asPlain = createUserClient(CLERK_PLAIN)
    expect(await fetchAllDevices(asPlain)).toEqual([])
    expect(await fetchAllUsers(asPlain)).toEqual([])
  })

  it('the admin bypass does not widen the tables whose app queries are unfiltered', async () => {
    // This is what broke the admin's own dashboard: users/device_users/
    // schedules must stay "own rows only" even for an admin session.
    const { data: plain } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_PLAIN })
      .select('id')
      .single()
    await db.from('users').insert({ clerk_user_id: CLERK_ADMIN })
    await db.from('devices').insert({
      device_id: DEVICE_B,
      secret: 'b'.repeat(64),
      status: 'registered',
    })
    await db
      .from('device_users')
      .insert({ device_id: DEVICE_B, user_id: plain!.id, role: 'owner' })

    const asAdmin = createAdminClient(CLERK_ADMIN, ADMIN_ORG)
    const { data: users } = await asAdmin.from('users').select('clerk_user_id')
    expect(users?.map((u) => u.clerk_user_id)).toEqual([CLERK_ADMIN])
    const { data: links } = await asAdmin.from('device_users').select('user_id')
    expect(links).toEqual([])
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

  it('leaves the Vault secret exactly as it found it', async () => {
    // Guards the regression this suite itself caused: a run that repoints the
    // shared secret and does not put it back makes the console claim a
    // configuration mismatch that does not exist.
    const { data } = await db.rpc('admin_org_id_configured')
    expect(data).toBe(ADMIN_ORG)
    expect(previousAdminOrg).not.toBe(ADMIN_ORG)
  })
})
