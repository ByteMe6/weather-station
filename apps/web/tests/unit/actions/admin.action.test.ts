const auth = jest.fn<
  Promise<{ userId: string | null; orgId: string | null }>,
  []
>()
const getOrganizationMembershipList = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@clerk/nextjs/server', () => ({
  auth: () => auth(),
  clerkClient: async () => ({ users: { getOrganizationMembershipList } }),
}))

const insert = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const update = jest.fn<Promise<{ error: unknown }>, [unknown]>()
const del = jest.fn<Promise<{ error: unknown }>, []>()
const vaultValue = jest.fn<Promise<{ data: unknown; error: unknown }>, []>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: (row: unknown) => insert(row),
      update: (patch: unknown) => ({ eq: async () => update(patch) }),
      delete: () => ({ eq: async () => del() }),
    }),
    rpc: async () => vaultValue(),
  }),
}))

import {
  createDeviceAction,
  deleteDeviceAction,
  getAdminStatusAction,
  rotateDeviceSecretAction,
  unclaimDeviceAction,
} from '@/actions/admin.action'

describe('admin actions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ADMIN_ORG_ID = 'org_admin123'
    auth.mockResolvedValue({ userId: 'user_1', orgId: 'org_admin123' })
    vaultValue.mockResolvedValue({ data: 'org_admin123', error: null })
  })

  it.each([
    ['no session', { userId: null, orgId: null }],
    ['a different active org', { userId: 'user_1', orgId: 'org_other' }],
  ])('createDeviceAction refuses %s', async (_label, session) => {
    auth.mockResolvedValue(session)
    await expect(createDeviceAction()).resolves.toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it('createDeviceAction inserts a well-formed id and secret and returns both once', async () => {
    insert.mockResolvedValue({ error: null })
    const res = await createDeviceAction()
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.deviceId).toMatch(/^ws-[0-9a-f]{12}$/)
    expect(res.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: res.data.deviceId,
        status: 'unregistered',
      }),
    )
  })

  it('createDeviceAction retries a colliding id', async () => {
    insert
      .mockResolvedValueOnce({ error: { code: '23505', message: 'dup' } })
      .mockResolvedValueOnce({ error: null })
    await expect(createDeviceAction()).resolves.toMatchObject({ ok: true })
    expect(insert).toHaveBeenCalledTimes(2)
  })

  it('rotateDeviceSecretAction writes a new secret and returns it', async () => {
    update.mockResolvedValue({ error: null })
    const res = await rotateDeviceSecretAction({ deviceId: 'ws-1' })
    expect(res.ok && res.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ secret: expect.any(String) as string }),
    )
  })

  it('deleteDeviceAction requires the device id typed as confirmation', async () => {
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-2' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(del).not.toHaveBeenCalled()
    del.mockResolvedValue({ error: null })
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('unclaimDeviceAction deletes the device links only', async () => {
    del.mockResolvedValue({ error: null })
    await expect(
      unclaimDeviceAction({ deviceId: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
    expect(del).toHaveBeenCalled()
  })

  describe('getAdminStatusAction', () => {
    it('reports ok, and flags a mismatch between the env and the vault', async () => {
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: false },
      })
      vaultValue.mockResolvedValue({ data: 'org_stale', error: null })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: true },
      })
    })

    it('asks for activation when the caller belongs to the admin org but has not activated it', async () => {
      auth.mockResolvedValue({ userId: 'user_1', orgId: null })
      getOrganizationMembershipList.mockResolvedValue({
        data: [{ organization: { id: 'org_admin123' } }],
      })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'needs-activation', orgId: 'org_admin123' },
      })
    })

    it('denies a user who is in no admin org', async () => {
      auth.mockResolvedValue({ userId: 'user_1', orgId: null })
      getOrganizationMembershipList.mockResolvedValue({
        data: [{ organization: { id: 'org_unrelated' } }],
      })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'denied' },
      })
    })
  })
})
