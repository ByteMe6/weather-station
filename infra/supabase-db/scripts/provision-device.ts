import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

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

// nvs_partition_gen.py consumes this CSV shape: a namespace row, then one
// row per key. It ships with the Arduino ESP32 framework package rather than
// being a project dependency, so the path is resolved at call time and a
// clear error beats a stack trace when it is missing.
const buildNvsCsv = (id: string, secret: string) =>
  [
    'key,type,encoding,value',
    'id,namespace,,',
    `device_id,data,string,${id}`,
    `secret,data,string,${secret}`,
    '',
  ].join('\n')

// 0x5000 — the nvs partition size in the stock esp32dev table. Passing a
// different size produces an image that either wastes space or overruns the
// partition, and esptool will happily write the overrun.
const NVS_PARTITION_SIZE = '0x5000'

const emitNvsImage = (id: string, secret: string, outPath: string) => {
  const csvPath = `${outPath}.csv`
  writeFileSync(csvPath, buildNvsCsv(id, secret), { mode: 0o600 })

  const gen = process.env.NVS_PARTITION_GEN
  if (!gen) {
    throw new Error(
      'Set NVS_PARTITION_GEN to nvs_partition_gen.py, e.g.\n' +
        '  export NVS_PARTITION_GEN="$(find ~/.platformio/packages/framework-arduinoespressif32 -name nvs_partition_gen.py | head -1)"',
    )
  }

  execFileSync('python3', [gen, 'generate', csvPath, outPath, NVS_PARTITION_SIZE], {
    stdio: 'inherit',
  })
}

const { deviceId, secret } = await registerDevice()

const emitIndex = process.argv.indexOf('--emit-nvs')
const nvsPath = emitIndex === -1 ? null : process.argv[emitIndex + 1]

console.error('\nDevice added (unregistered).')
console.error(`  DEVICE_ID = ${deviceId}`)

if (!nvsPath) {
  // The secret only goes to stderr, never stdout, so a plain `> file`
  // redirect can't silently capture it (an explicit `2>` still would).
  console.error(`  DEVICE_SECRET = ${secret}`)
  console.error('\nPass --emit-nvs <path> to write a flashable NVS image instead.\n')
} else {
  emitNvsImage(deviceId, secret, nvsPath)
  console.error(`\nWrote ${nvsPath}. Flash it to a CLEAN device with:`)
  console.error(
    `  esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 ${nvsPath}\n`,
  )
  console.error(
    'This erases the whole NVS partition, including saved WiFi credentials.\n' +
      `Delete ${nvsPath} and ${nvsPath}.csv once flashed - both hold the secret.\n`,
  )
}
