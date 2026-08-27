import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env
const [url, secret] = process.argv.slice(2)

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first.')
}
if (!url?.startsWith('http') || !secret) {
  throw new Error(
    'Usage: yarn cron:set-secret <alert-dispatcher-url> <cron-secret>\n' +
      '  local url:  http://host.docker.internal:54321/functions/v1/alert-dispatcher\n' +
      '  prod url:   https://<project-ref>.supabase.co/functions/v1/alert-dispatcher',
  )
}

// Vault is only reachable with the service-role key. The names are what
// public.invoke_alert_dispatcher() looks up.
const db = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY)

const { error } = await db.rpc('set_alert_cron_config', {
  p_url: url,
  p_secret: secret,
})
if (error) throw new Error(error.message)

console.error(`alert_dispatcher_url + alert_cron_secret set (url: ${url})`)
console.error(
  'Also set CRON_SECRET to the same secret for the function: npx supabase secrets set CRON_SECRET=…',
)
