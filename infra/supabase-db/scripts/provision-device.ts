import { randomBytes, randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY first (see .env.example).',
  )
}

// Built inline rather than reused from createServiceRoleClient() in
// @ws/supabase-db: that factory starts with `import 'server-only'` and sits
// behind the package barrel, neither of which this standalone
// `node --experimental-strip-types` script should depend on (server-only
// guards client bundles — a CLI is never bundled). Config is intentionally
// identical to the canonical factory; keep them in step if it grows options.
const db = createClient<Database>(SUPABASE_URL, SUPABASE_SECRET_KEY)

const makeDeviceId = () => `ws-${randomUUID().replaceAll('-', '').slice(0, 12)}`
const makeSecret = () => randomBytes(32).toString('hex')

// retry on the off chance the random id collides (device_id is the PK)
const registerDevice = async () => {
  for (let tries = 0; tries < 5; tries += 1) {
    const deviceId = makeDeviceId()
    const secret = makeSecret()

    const { error } = await db
      .from('devices')
      .insert({ device_id: deviceId, secret, status: 'unregistered' })

    if (!error) return { deviceId, secret }
    if (error.code !== '23505') throw new Error(error.message)
  }

  throw new Error('device_id kept colliding, gave up after 5 tries')
}

const { deviceId, secret } = await registerDevice()

// Write to stderr, not stdout, so a plain `> file` redirect of stdout won't
// silently capture the secret to disk (an explicit `2>` still would).
console.error(
  '\nDevice added (unregistered). Put these in secrets.ini before flashing:',
)
console.error(`  DEVICE_ID     = ${deviceId}`)
console.error(`  DEVICE_SECRET = ${secret}\n`)
