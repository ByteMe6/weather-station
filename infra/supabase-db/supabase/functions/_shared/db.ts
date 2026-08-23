// Service-role client for the bot's own DB access (RLS bypassed): every
// caller must scope queries by the Telegram user's identity in code.
import { createClient } from '@supabase/supabase-js'

export const serviceClient = () => {
  const url = Deno.env.get('SUPABASE_URL')
  const key =
    Deno.env.get('SUPABASE_SECRET_KEY') ??
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key)
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY are not set')
  return createClient(url, key)
}
