const verifyWebhook = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@clerk/nextjs/webhooks', () => ({
  verifyWebhook: (r: unknown) => verifyWebhook(r),
}))
const erase = jest.fn<Promise<unknown>, [unknown, string]>()
jest.mock('@/services/users/users.service', () => ({
  deleteUserByClerkId: (c: unknown, p: { clerkUserId: string }) =>
    erase(c, p.clerkUserId),
}))
jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: () => ({}) }))

import { POST } from '@/app/api/webhooks/clerk/route'

const req = () =>
  new Request('http://localhost/api/webhooks/clerk', {
    method: 'POST',
    body: '{}',
  })

describe('POST /api/webhooks/clerk', () => {
  beforeEach(() => jest.clearAllMocks())
  it('erases on user.deleted', async () => {
    verifyWebhook.mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'user_9' },
    })
    erase.mockResolvedValue({ deletedUsers: 1 })
    const res = await POST(req() as never)
    expect(res.status).toBe(200)
    expect(erase).toHaveBeenCalledWith({}, 'user_9')
  })
  it('returns 400 when the signature is invalid', async () => {
    verifyWebhook.mockRejectedValue(new Error('bad sig'))
    const res = await POST(req() as never)
    expect(res.status).toBe(400)
    expect(erase).not.toHaveBeenCalled()
  })
  it('ignores other events', async () => {
    verifyWebhook.mockResolvedValue({
      type: 'user.created',
      data: { id: 'user_1' },
    })
    const res = await POST(req() as never)
    expect(res.status).toBe(200)
    expect(erase).not.toHaveBeenCalled()
  })
})
