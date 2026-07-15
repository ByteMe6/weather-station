import { randomBytes, randomUUID } from 'node:crypto'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '../src/types/database'

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error(
    'Set SUPABASE_URL and SUPABASE_SECRET_KEY first (see .env.example).',
  )
}

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

// stderr so the secret can't be captured by piping stdout somewhere
console.error(
  '\nDevice added (unregistered). Put these in secrets.ini before flashing:',
)
console.error(`  DEVICE_ID     = ${deviceId}`)
console.error(`  DEVICE_SECRET = ${secret}\n`)
