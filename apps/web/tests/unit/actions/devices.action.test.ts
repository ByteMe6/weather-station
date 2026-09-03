const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const ensure = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/users.action', () => ({
  ensureCurrentUserAction: () => ensure(),
}))
const rpc = jest.fn<Promise<{ error: unknown }>, unknown[]>()
const identities = jest.fn<
  Promise<unknown[]>,
  [unknown, { deviceId: string }]
>()
jest.mock('@/services/devices/devices.service', () => ({
  fetchDeviceMemberIdentities: (c: unknown, p: { deviceId: string }) =>
    identities(c, p),
}))
const clerkProfiles = jest.fn<
  Promise<Map<string, unknown>>,
  [readonly string[]]
>()
jest.mock('@/lib/clerk/profiles', () => ({
  fetchClerkProfiles: (ids: readonly string[]) => clerkProfiles(ids),
}))
const helpers = {
  resolveCurrentUserId: jest.fn<Promise<string | null>, unknown[]>(),
  resolveMemberRole: jest.fn<Promise<string | null>, unknown[]>(),
}
jest.mock('@/actions/_helpers', () => helpers)
const from = jest.fn<unknown, [string]>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => from(table),
  }),
}))
const findClerkUserIdByEmail = jest.fn<Promise<string | null>, [string]>()
jest.mock('@/lib/clerk/lookup', () => ({
  findClerkUserIdByEmail: (email: string) => findClerkUserIdByEmail(email),
}))

import {
  getDeviceMemberProfilesAction,
  registerDeviceAction,
  removeMemberAction,
  shareDeviceAction,
  updateDeviceProfileAction,
  updateMemberRoleAction,
} from '@/actions/devices.action'
import { normalizeDeviceId } from '@/lib/device-id'

describe('registerDeviceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    ensure.mockResolvedValue({ ok: true, data: { userId: 'uuid-1' } })
  })

  it('normalizes ids', () => {
    expect(normalizeDeviceId('  WS-3F2A9B7C1D0E ')).toBe('ws-3f2a9b7c1d0e')
  })

  it('rejects empty input with a field error', async () => {
    const res = await registerDeviceAction({ deviceId: '   ' })
    expect(res).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { deviceId: expect.any(String) as string },
    })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('claims via RPC with the internal user id', async () => {
    rpc.mockResolvedValue({ error: null })
    await expect(
      registerDeviceAction({ deviceId: 'WS-3F2A9B7C1D0E' }),
    ).resolves.toEqual({ ok: true, data: { deviceId: 'ws-3f2a9b7c1d0e' } })
    expect(rpc).toHaveBeenCalledWith('claim_device', {
      p_device_id: 'ws-3f2a9b7c1d0e',
      p_user_id: 'uuid-1',
    })
  })

  it.each([
    ['DEVICE_NOT_FOUND', 'DEVICE_NOT_FOUND'],
    ['DEVICE_ALREADY_CLAIMED', 'DEVICE_ALREADY_CLAIMED'],
    ['something else', 'UNKNOWN'],
  ])('maps SQL error "%s" to %s', async (message, code) => {
    rpc.mockResolvedValue({ error: { message, code: 'P0001', details: null } })
    await expect(
      registerDeviceAction({ deviceId: 'WS-1' }),
    ).resolves.toMatchObject({ ok: false, code })
  })
})

/** Leaves of the `service.from(...)` chains the share path walks. */
const usersUpsert = jest.fn<
  Promise<{ data: { id: string } | null; error: unknown }>,
  [Record<string, unknown>]
>()
const usersSelectEq = jest.fn<
  Promise<{ data: { id: string } | null; error: unknown }>,
  [string, unknown]
>()
const deviceUsersInsert = jest.fn<
  Promise<{ error: unknown }>,
  [Record<string, unknown>]
>()

const stubTables = (): void => {
  from.mockImplementation((table: string) => {
    if (table === 'users')
      return {
        upsert: (values: Record<string, unknown>) => ({
          select: () => ({ single: () => usersUpsert(values) }),
        }),
        select: () => ({
          eq: (column: string, value: unknown) => ({
            maybeSingle: () => usersSelectEq(column, value),
          }),
        }),
      }
    if (table === 'device_users')
      return {
        insert: (row: Record<string, unknown>) => deviceUsersInsert(row),
      }
    throw new Error(`unexpected table ${table}`)
  })
}

describe('shareDeviceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
    helpers.resolveMemberRole.mockResolvedValue('owner')
    stubTables()
    deviceUsersInsert.mockResolvedValue({ error: null })
  })

  it('grants access by email, resolving the address through Clerk', async () => {
    findClerkUserIdByEmail.mockResolvedValue('user_target')
    usersUpsert.mockResolvedValue({ data: { id: 'uuid-target' }, error: null })
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: '  Ada@Example.COM ',
        role: 'viewer',
      }),
    ).resolves.toEqual({ ok: true, data: { userId: 'uuid-target' } })
    expect(findClerkUserIdByEmail).toHaveBeenCalledWith('ada@example.com')
    expect(deviceUsersInsert).toHaveBeenCalledWith({
      device_id: 'ws-1',
      user_id: 'uuid-target',
      role: 'viewer',
    })
  })

  it('upserts the users row so an account that never opened the dashboard can still be granted', async () => {
    findClerkUserIdByEmail.mockResolvedValue('user_target')
    usersUpsert.mockResolvedValue({ data: { id: 'uuid-target' }, error: null })
    await shareDeviceAction({
      deviceId: 'ws-1',
      identifier: 'ada@example.com',
      role: 'viewer',
    })
    expect(usersUpsert).toHaveBeenCalledWith({ clerk_user_id: 'user_target' })
    expect(usersSelectEq).not.toHaveBeenCalled()
  })

  it('reports USER_NOT_FOUND when no Clerk account owns that email', async () => {
    findClerkUserIdByEmail.mockResolvedValue(null)
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ghost@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'USER_NOT_FOUND',
      fieldErrors: { identifier: expect.any(String) as string },
    })
    expect(deviceUsersInsert).not.toHaveBeenCalled()
  })

  it('reports UNKNOWN when the users upsert fails', async () => {
    findClerkUserIdByEmail.mockResolvedValue('user_target')
    usersUpsert.mockResolvedValue({ data: null, error: { message: 'nope' } })
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'UNKNOWN' })
    expect(deviceUsersInsert).not.toHaveBeenCalled()
  })

  it('still grants access by Telegram id, looking the row up rather than creating it', async () => {
    usersSelectEq.mockResolvedValue({ data: { id: 'uuid-tg' }, error: null })
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: '123456789',
        role: 'editor',
      }),
    ).resolves.toEqual({ ok: true, data: { userId: 'uuid-tg' } })
    expect(usersSelectEq).toHaveBeenCalledWith('telegram_id', 123456789)
    expect(findClerkUserIdByEmail).not.toHaveBeenCalled()
    expect(usersUpsert).not.toHaveBeenCalled()
    expect(deviceUsersInsert).toHaveBeenCalledWith({
      device_id: 'ws-1',
      user_id: 'uuid-tg',
      role: 'editor',
    })
  })

  it('reports USER_NOT_FOUND for a Telegram id the bot has never seen', async () => {
    usersSelectEq.mockResolvedValue({ data: null, error: null })
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: '123456789',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'USER_NOT_FOUND' })
  })

  it('maps the unique violation to ALREADY_MEMBER', async () => {
    findClerkUserIdByEmail.mockResolvedValue('user_target')
    usersUpsert.mockResolvedValue({ data: { id: 'uuid-target' }, error: null })
    deviceUsersInsert.mockResolvedValue({ error: { code: '23505' } })
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'ALREADY_MEMBER' })
  })

  it('rejects non-owners with FORBIDDEN', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(findClerkUserIdByEmail).not.toHaveBeenCalled()
  })

  it('validates the role and identifier before touching Clerk or the DB', async () => {
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'admin' as never,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await expect(
      shareDeviceAction({ deviceId: '', identifier: 'nope', role: 'viewer' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    // a raw Clerk id is no longer an accepted identifier
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'user_2abcDEF12345',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(helpers.resolveCurrentUserId).not.toHaveBeenCalled()
    expect(findClerkUserIdByEmail).not.toHaveBeenCalled()
  })

  it('reports UNKNOWN when the ownership lookup fails (not FORBIDDEN)', async () => {
    helpers.resolveCurrentUserId.mockRejectedValue(new Error('db down'))
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'UNKNOWN' })
  })
})

describe('member actions input validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
  })
  it('rejects a non-uuid userId and an unknown role without hitting the DB', async () => {
    await expect(
      updateMemberRoleAction({
        deviceId: 'ws-1',
        userId: 'not-a-uuid',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await expect(
      updateMemberRoleAction({
        deviceId: 'ws-1',
        userId: '00000000-0000-0000-0000-00000000000b',
        role: 'root' as never,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await expect(
      removeMemberAction({ deviceId: 'ws-1', userId: 'nope' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(helpers.resolveCurrentUserId).not.toHaveBeenCalled()
  })
})

describe('updateDeviceProfileAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
  })
  it('rejects an over-long nickname with a field error', async () => {
    const res = await updateDeviceProfileAction({
      deviceId: 'ws-1',
      label: 'x'.repeat(41),
      address: '',
      latitude: '',
      longitude: '',
    })
    expect(res).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { label: expect.any(String) as string },
    })
  })
  const PROFILE = {
    deviceId: 'ws-1',
    label: 'Backyard',
    address: '',
    latitude: '',
    longitude: '',
  }
  const rowUpdate = () => {
    const single = jest.fn(async () => ({
      data: {
        label: 'Backyard',
        address: null,
        latitude: null,
        longitude: null,
      },
      error: null,
    }))
    from.mockReturnValue({
      update: () => ({
        eq: () => ({ select: () => ({ maybeSingle: single }) }),
      }),
    })
    return single
  }

  // The station's details belong to the device and every member already sees
  // them; changing them grants nobody access to anything. Membership does grant
  // access, which is why that stays with the owner (asserted below).
  it.each(['owner', 'editor'])(
    'lets a %s edit the station details',
    async (role) => {
      helpers.resolveMemberRole.mockResolvedValue(role)
      const single = rowUpdate()
      await expect(updateDeviceProfileAction(PROFILE)).resolves.toMatchObject({
        ok: true,
        data: { label: 'Backyard' },
      })
      expect(single).toHaveBeenCalled()
    },
  )

  it.each(['viewer', null])(
    'refuses a %s, without touching the row',
    async (role) => {
      helpers.resolveMemberRole.mockResolvedValue(role)
      const single = rowUpdate()
      await expect(updateDeviceProfileAction(PROFILE)).resolves.toMatchObject({
        ok: false,
        code: 'FORBIDDEN',
      })
      expect(single).not.toHaveBeenCalled()
    },
  )

  it('rejects an out-of-range latitude and a half-filled pair', async () => {
    helpers.resolveMemberRole.mockResolvedValue('owner')
    await expect(
      updateDeviceProfileAction({
        deviceId: 'ws-1',
        label: '',
        address: '',
        latitude: '91',
        longitude: '24.0297',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { latitude: expect.any(String) as string },
    })
    await expect(
      updateDeviceProfileAction({
        deviceId: 'ws-1',
        label: '',
        address: '',
        latitude: '49.8397',
        longitude: '',
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { longitude: expect.any(String) as string },
    })
  })

  it('rejects a non-numeric coordinate', async () => {
    helpers.resolveMemberRole.mockResolvedValue('owner')
    await expect(
      updateDeviceProfileAction({
        deviceId: 'ws-1',
        label: '',
        address: '',
        latitude: 'north',
        longitude: '24.0297',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})

// Editors gained the right to edit a station's details. The point of splitting
// the gate rather than widening one flag is that nothing about membership moved
// with it — an editor who could share, promote or remove would be an owner by
// another name, and `editor` was a label with no meaning until now precisely
// because a single `role === 'owner'` check guarded both concerns.
describe('membership stays owner-only', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
    helpers.resolveMemberRole.mockResolvedValue('editor')
  })

  it('refuses an editor sharing the station', async () => {
    await expect(
      shareDeviceAction({
        deviceId: 'ws-1',
        identifier: 'someone@example.com',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses an editor changing a role', async () => {
    await expect(
      updateMemberRoleAction({
        deviceId: 'ws-1',
        userId: '00000000-0000-0000-0000-0000000000b2',
        role: 'owner',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses an editor removing a member', async () => {
    await expect(
      removeMemberAction({
        deviceId: 'ws-1',
        userId: '00000000-0000-0000-0000-0000000000b2',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('getDeviceMemberProfilesAction', () => {
  const all = [
    { userId: 'u-owner', clerkUserId: 'user_owner' },
    { userId: 'u-viewer', clerkUserId: 'user_viewer' },
    { userId: 'u-tg', clerkUserId: null },
  ]
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_owner' })
    helpers.resolveCurrentUserId.mockResolvedValue('u-owner')
    identities.mockResolvedValue(all)
    clerkProfiles.mockResolvedValue(
      new Map([
        ['user_owner', { name: 'Olive Owner', avatarUrl: 'o.png' }],
        ['user_viewer', { name: 'Vic Viewer', avatarUrl: null }],
      ]),
    )
  })
  it('owner gets every member with a Clerk profile, keyed by internal id; Telegram-only members are absent', async () => {
    helpers.resolveMemberRole.mockResolvedValue('owner')
    await expect(
      getDeviceMemberProfilesAction({ deviceId: 'ws-1' }),
    ).resolves.toEqual({
      ok: true,
      data: {
        'u-owner': { name: 'Olive Owner', avatarUrl: 'o.png' },
        'u-viewer': { name: 'Vic Viewer', avatarUrl: null },
      },
    })
    expect(clerkProfiles).toHaveBeenCalledWith(['user_owner', 'user_viewer'])
  })
  it('a non-owner member only gets their own profile — no other Clerk id is even looked up', async () => {
    helpers.resolveCurrentUserId.mockResolvedValue('u-viewer')
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    const res = await getDeviceMemberProfilesAction({ deviceId: 'ws-1' })
    expect(res).toMatchObject({ ok: true, data: { 'u-viewer': {} } })
    expect(res.ok && Object.keys(res.data)).toEqual(['u-viewer'])
    expect(clerkProfiles).toHaveBeenCalledWith(['user_viewer'])
  })
  it('non-members are refused before any lookup', async () => {
    helpers.resolveMemberRole.mockResolvedValue(null)
    await expect(
      getDeviceMemberProfilesAction({ deviceId: 'ws-1' }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(identities).not.toHaveBeenCalled()
    expect(clerkProfiles).not.toHaveBeenCalled()
  })
  it('a Clerk outage is UNKNOWN, not a crash', async () => {
    helpers.resolveMemberRole.mockResolvedValue('owner')
    clerkProfiles.mockRejectedValue(new Error('clerk 503'))
    await expect(
      getDeviceMemberProfilesAction({ deviceId: 'ws-1' }),
    ).resolves.toMatchObject({ ok: false, code: 'UNKNOWN' })
  })
})
