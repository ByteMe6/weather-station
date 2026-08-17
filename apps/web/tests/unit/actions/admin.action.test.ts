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
// Writes now prove a row was hit before reporting success, so the mocks return
// the affected rows the way PostgREST's `.select()` does.
const update = jest.fn<
  Promise<{ data: unknown[]; error: unknown }>,
  [unknown]
>()
const del = jest.fn<Promise<{ data: unknown[]; error: unknown }>, []>()
const lookup = jest.fn<Promise<{ data: unknown; error: unknown }>, []>()
const vaultValue = jest.fn<Promise<{ data: unknown; error: unknown }>, []>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({
    // Table-aware because the two delete paths differ on purpose: deleting a
    // device must prove a row was hit, while unclaiming one that already has no
    // members is a legitimate no-op.
    from: (table: string) => ({
      insert: (row: unknown) => insert(row),
      update: (patch: unknown) => ({
        eq: () => ({ select: async () => update(patch) }),
      }),
      delete: () =>
        table === 'devices'
          ? { eq: () => ({ select: async () => del() }) }
          : { eq: async () => del() },
      select: () => ({ eq: () => ({ maybeSingle: async () => lookup() }) }),
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
    lookup.mockResolvedValue({ data: { device_id: 'ws-1' }, error: null })
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
    update.mockResolvedValue({ data: [{ device_id: 'ws-1' }], error: null })
    const res = await rotateDeviceSecretAction({ deviceId: 'ws-1' })
    expect(res.ok && res.data.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ secret: expect.any(String) as string }),
    )
  })

  it('rotateDeviceSecretAction never hands back a secret it did not store', async () => {
    // PostgREST reports no error when an update matches zero rows; returning
    // the generated secret then bricks the station it was flashed to.
    update.mockResolvedValue({ data: [], error: null })
    await expect(
      rotateDeviceSecretAction({ deviceId: 'ws-gone' }),
    ).resolves.toMatchObject({ ok: false, code: 'DEVICE_NOT_FOUND' })
  })

  it('deleteDeviceAction reports NOT_FOUND when nothing was deleted', async () => {
    del.mockResolvedValue({ data: [], error: null })
    await expect(
      deleteDeviceAction({ deviceId: 'ws-gone', confirmation: 'ws-gone' }),
    ).resolves.toMatchObject({ ok: false, code: 'DEVICE_NOT_FOUND' })
  })

  it('unclaimDeviceAction reports NOT_FOUND for a device that no longer exists', async () => {
    lookup.mockResolvedValue({ data: null, error: null })
    await expect(
      unclaimDeviceAction({ deviceId: 'ws-gone' }),
    ).resolves.toMatchObject({ ok: false, code: 'DEVICE_NOT_FOUND' })
  })

  it('deleteDeviceAction requires the device id typed as confirmation', async () => {
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-2' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(del).not.toHaveBeenCalled()
    del.mockResolvedValue({ data: [{ device_id: 'ws-1' }], error: null })
    await expect(
      deleteDeviceAction({ deviceId: 'ws-1', confirmation: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('unclaimDeviceAction deletes the device links only', async () => {
    del.mockResolvedValue({ data: [], error: null })
    await expect(
      unclaimDeviceAction({ deviceId: 'ws-1' }),
    ).resolves.toMatchObject({ ok: true })
    expect(del).toHaveBeenCalled()
  })

  describe('getAdminStatusAction', () => {
    it('reports ok, and flags a mismatch between the env and the vault', async () => {
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: false, configUnavailable: false },
      })
      vaultValue.mockResolvedValue({ data: 'org_stale', error: null })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: true },
      })
    })

    it('reports an unreadable vault as unavailable, not as drift', async () => {
      // Telling the operator to run admin:set-org would send them after a
      // config problem that does not exist.
      vaultValue.mockResolvedValue({
        data: null,
        error: { message: 'vault down', code: '42883' },
      })
      await expect(getAdminStatusAction()).resolves.toMatchObject({
        ok: true,
        data: { state: 'ok', configMismatch: false, configUnavailable: true },
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
