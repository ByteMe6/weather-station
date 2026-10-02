import { createClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

import { describeApiKeyProvider } from '../../../helpers/api-key-provider-contract'

import { ownApiKeyProvider } from '@/lib/api/keys/own-provider'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
const db = createClient<Database>(url ?? '', key ?? '')

const CLERK_A = 'user_inttest_provider_a'
const CLERK_B = 'user_inttest_provider_b'

const makeUser = async (clerkUserId: string): Promise<string> => {
  const { data, error } = await db
    .from('users')
    .insert({ clerk_user_id: clerkUserId })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

describeApiKeyProvider(
  'own (api_keys table)',
  async () => ({
    provider: ownApiKeyProvider,
    ownerA: { userId: await makeUser(CLERK_A), clerkUserId: CLERK_A },
    ownerB: { userId: await makeUser(CLERK_B), clerkUserId: CLERK_B },
  }),
  async () => {
    // Cascades to api_keys. The contract never hits the limiter, so there are
    // no rate-limit buckets to clean (revokeApiKeyAction drops them).
    await db.from('users').delete().in('clerk_user_id', [CLERK_A, CLERK_B])
  },
)
