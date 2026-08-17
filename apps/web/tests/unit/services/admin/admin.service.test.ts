import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { fetchAllDevices, fetchAllUsers } from '@/services/admin/admin.service'
import { ServiceError } from '@/services/database/types'

const clientReturning = (result: { data: unknown; error: unknown }) => {
  const rpc = jest.fn(async () => result)
  return {
    client: { rpc } as unknown as SupabaseClient<Database>,
    rpc,
  }
}

describe('fetchAllDevices', () => {
  it('calls the admin_devices RPC and maps its snake_case rows', async () => {
    const { client, rpc } = clientReturning({
      data: [
        {
          device_id: 'ws-1',
          status: 'registered',
          label: 'Backyard',
          created_at: '2026-08-01T00:00:00Z',
          member_count: 2,
        },
      ],
      error: null,
    })
    await expect(fetchAllDevices(client)).resolves.toEqual([
      {
        deviceId: 'ws-1',
        status: 'registered',
        label: 'Backyard',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 2,
      },
    ])
    expect(rpc).toHaveBeenCalledWith('admin_devices')
  })

  it('treats a device with no members as zero, not NaN', async () => {
    const { client } = clientReturning({
      data: [
        {
          device_id: 'ws-2',
          status: 'unregistered',
          label: null,
          created_at: '2026-08-01T00:00:00Z',
          member_count: 0,
        },
      ],
      error: null,
    })
    await expect(fetchAllDevices(client)).resolves.toMatchObject([
      { memberCount: 0 },
    ])
  })

  it('throws ServiceError when the RPC fails', async () => {
    const { client } = clientReturning({
      data: null,
      error: { message: 'denied', code: '42501', details: null },
    })
    await expect(fetchAllDevices(client)).rejects.toBeInstanceOf(ServiceError)
  })
})

describe('fetchAllUsers', () => {
  it('calls the admin_users RPC and maps its rows', async () => {
    const { client, rpc } = clientReturning({
      data: [
        {
          id: 'u1',
          clerk_user_id: 'user_abcd',
          telegram_id: null,
          created_at: '2026-08-01T00:00:00Z',
          device_count: 3,
        },
      ],
      error: null,
    })
    await expect(fetchAllUsers(client)).resolves.toEqual([
      {
        id: 'u1',
        clerkUserId: 'user_abcd',
        telegramId: null,
        createdAt: '2026-08-01T00:00:00Z',
        deviceCount: 3,
      },
    ])
    expect(rpc).toHaveBeenCalledWith('admin_users')
  })
})
