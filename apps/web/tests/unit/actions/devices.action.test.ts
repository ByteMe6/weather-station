const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const ensure = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/users.action', () => ({
  ensureCurrentUserAction: () => ensure(),
}))
const rpc = jest.fn<Promise<{ error: unknown }>, unknown[]>()
const helpers = {
  resolveCurrentUserId: jest.fn<Promise<string | null>, unknown[]>(),
  resolveMemberRole: jest.fn<Promise<string | null>, unknown[]>(),
}
jest.mock('@/actions/_helpers', () => helpers)
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
}))

import {
  registerDeviceAction,
  removeMemberAction,
  shareDeviceAction,
  updateDeviceProfileAction,
  updateMemberRoleAction,
} from '@/actions/devices.action'
import { normalizeDeviceId } from '@/lib/device-id'
import { parseShareIdentifier } from '@/lib/share-identifier'

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

describe('shareDeviceAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
  })
  it('parses identifiers', () => {
    expect(parseShareIdentifier('123456')).toEqual({
      kind: 'telegram',
      telegramId: 123456,
    })
    expect(parseShareIdentifier('user_2abcDEF12345')).toEqual({
      kind: 'clerk',
      clerkUserId: 'user_2abcDEF12345',
    })
    expect(parseShareIdentifier('nope')).toBeNull()
  })
  it('rejects non-owners with FORBIDDEN', async () => {
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(
      shareDeviceAction({
        deviceId: 'WS-1',
        identifier: 'user_2abcDEF12345',
        role: 'viewer',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
  it('validates the role and identifier before touching the DB', async () => {
    await expect(
      shareDeviceAction({
        deviceId: 'WS-1',
        identifier: 'user_2abcDEF12345',
        role: 'admin' as never,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    await expect(
      shareDeviceAction({ deviceId: '', identifier: 'nope', role: 'viewer' }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(helpers.resolveCurrentUserId).not.toHaveBeenCalled()
  })
  it('reports UNKNOWN when the ownership lookup fails (not FORBIDDEN)', async () => {
    helpers.resolveCurrentUserId.mockRejectedValue(new Error('db down'))
    await expect(
      shareDeviceAction({
        deviceId: 'WS-1',
        identifier: 'user_2abcDEF12345',
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
    })
    expect(res).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { label: expect.any(String) as string },
    })
  })
  it('rejects non-owners', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(
      updateDeviceProfileAction({
        deviceId: 'ws-1',
        label: 'Backyard',
        address: '',
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })
})
