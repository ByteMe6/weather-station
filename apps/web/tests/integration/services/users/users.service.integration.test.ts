import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { createUserClient } from '../../helpers/auth-client'

import { fetchCurrentUser } from '@/services/users/users.service'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_users_a'
const CLERK_B = 'user_inttest_users_b'

beforeAll(() => {
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY to the local Supabase values (npx supabase status).',
    )
  }
})

afterEach(async () => {
  await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
})

describe('users service (integration)', () => {
  it('fetchCurrentUser returns only the caller’s row (RLS)', async () => {
    const { data: a } = await db
      .from('users')
      .insert({ clerk_user_id: CLERK_A })
      .select('id')
      .single()
    await db.from('users').insert({ clerk_user_id: CLERK_B })

    const asA = createUserClient(CLERK_A)
    const me = await fetchCurrentUser(asA)
    expect(me).toMatchObject({
      id: a?.id,
      clerkUserId: CLERK_A,
      telegramId: null,
    })

    const asNobody = createUserClient('user_inttest_users_none')
    expect(await fetchCurrentUser(asNobody)).toBeNull()
  })
})
