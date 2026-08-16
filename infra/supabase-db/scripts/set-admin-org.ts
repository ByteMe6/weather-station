import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env
const orgId = process.argv[2]

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')
}
if (!orgId?.startsWith('org_')) {
  throw new Error('Usage: yarn admin:set-org org_xxxxxxxxxxxxxxxx')
}

// Vault is only reachable with the service-role key. The secret name is what
// public.is_admin_request() looks up; changing it means changing that function.
const db = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY)

const { error } = await db.rpc('set_admin_org_id', { p_org_id: orgId })
if (error) throw new Error(error.message)

console.error(`admin_org_id set to ${orgId}`)
console.error(
  'Set ADMIN_ORG_ID to the same value in the app environment (Infisical / Vercel).',
)
