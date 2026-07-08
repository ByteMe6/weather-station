import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from './types/database'

/**
 * Service-role client — bypasses RLS. For server-only paths: the HMAC ingest
 * route (POST /api/readings), server actions, and scheduled jobs. Ownership
 * must be checked in application code because RLS does not apply here.
 */
export const createServiceRoleClient = () =>
  createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
  )
