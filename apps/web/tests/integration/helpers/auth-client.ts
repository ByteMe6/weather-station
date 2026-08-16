import { createHmac } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@ws/supabase-db'

// Local Supabase default JWT secret (override with SUPABASE_JWT_SECRET).
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long'

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString('base64url')

/**
 * Signs an HS256 JWT the way Clerk's would look to RLS: `sub` is the Clerk
 * user id and `role` is `authenticated`, so current_app_user_id() resolves.
 */
export const signTestJwt = (clerkUserId: string): string => {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: clerkUserId,
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase-test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${sig}`
}

/** RLS-enforced client acting as the given Clerk user (publishable key + signed JWT). */
export const createUserClient = (
  clerkUserId: string,
): SupabaseClient<Database> => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (npx supabase status).',
    )
  }
  const token = signTestJwt(clerkUserId)
  return createClient<Database>(url, key, {
    accessToken: async () => token,
  })
}
