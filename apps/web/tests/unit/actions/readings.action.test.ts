const auth = jest.fn<Promise<{ userId: string | null }>, []>()
jest.mock('@clerk/nextjs/server', () => ({ auth: () => auth() }))
const helpers = {
  resolveCurrentUserId: jest.fn<Promise<string | null>, unknown[]>(),
  resolveMemberRole: jest.fn<Promise<string | null>, unknown[]>(),
}
jest.mock('@/actions/_helpers', () => helpers)
const rows = jest.fn<{ data: unknown; error: unknown }, []>()
jest.mock('@ws/supabase-db', () => ({
  createServiceRoleClient: () => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: self,
      eq: self,
      gte: self,
      lte: self,
      or: self,
      order: self,
      limit: self,
      then: (res: (v: unknown) => void) => res(rows()),
    })
    return { from: () => chain }
  },
}))

import { exportReadingsChunkAction } from '@/actions/readings.action'

describe('exportReadingsChunkAction', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ userId: 'user_1' })
    helpers.resolveCurrentUserId.mockResolvedValue('uuid-1')
  })

  it('rejects non-members', async () => {
    helpers.resolveMemberRole.mockResolvedValue(null)
    await expect(
      exportReadingsChunkAction({
        deviceId: 'WS-1',
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-02T00:00:00Z',
        cursor: null,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'FORBIDDEN' })
  })

  it('rejects ranges over 366 days', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    await expect(
      exportReadingsChunkAction({
        deviceId: 'WS-1',
        from: '2024-01-01T00:00:00Z',
        to: '2026-08-02T00:00:00Z',
        cursor: null,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })

  it('returns header + lines on the first chunk and a cursor when full', async () => {
    helpers.resolveMemberRole.mockResolvedValue('viewer')
    const data = Array.from({ length: 1_000 }, (_, i) => ({
      id: i + 1,
      deviceId: 'WS-1',
      timestamp: `2026-08-01T00:${String(i % 60).padStart(2, '0')}:00.000Z`,
      temperature: 20,
      humidity: null,
      pressure: 1000,
      windSpeed: null,
      windDirection: null,
      precipitation: null,
    }))
    rows.mockReturnValue({ data, error: null })
    const res = await exportReadingsChunkAction({
      deviceId: 'WS-1',
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-02T00:00:00Z',
      cursor: null,
    })
    expect(res.ok && res.data.includesHeader).toBe(true)
    expect(res.ok && res.data.lines).toHaveLength(1_001)
    expect(res.ok && res.data.nextCursor).toEqual({
      timestamp: data[999]!.timestamp,
      id: 1_000,
    })
  })
})
