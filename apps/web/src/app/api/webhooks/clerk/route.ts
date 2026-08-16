import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { createServiceRoleClient } from '@ws/supabase-db'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

import { eraseUserByClerkId } from '@/lib/account/erase-user'

/**
 * Clerk → us: a user deleted from the Clerk dashboard must not leave orphaned
 * rows (MRP-40). Verified with svix via CLERK_WEBHOOK_SIGNING_SECRET.
 */
export const POST = async (req: NextRequest): Promise<NextResponse> => {
  let evt: Awaited<ReturnType<typeof verifyWebhook>>
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('clerk webhook: signature verification failed', err)
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
  }
  if (evt.type === 'user.deleted' && evt.data.id) {
    try {
      await eraseUserByClerkId(createServiceRoleClient(), evt.data.id)
    } catch (err) {
      console.error('clerk webhook: erase failed', err)
      return NextResponse.json({ error: 'erase failed' }, { status: 500 })
    }
  }
  return NextResponse.json({ ok: true })
}
