import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, unlinkSync, writeFileSync } from 'node:fs'

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
// row per key.
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

// Default to the PyPI module, not to a path found inside the PlatformIO
// Arduino framework package: that package only ships gen_esp32part.py (the
// partition *table* generator) and does not contain nvs_partition_gen.py at
// all — pointing users there is a dead end. Espressif publishes the NVS image
// generator standalone on PyPI as esp-idf-nvs-partition-gen, so invoke it as a
// module by default. NVS_PARTITION_GEN remains an override for anyone who
// already has a full ESP-IDF checkout with nvs_partition_gen.py on disk.
const nvsGeneratorArgs = (override: string | undefined): readonly string[] =>
  override ? [override] : ['-m', 'esp_idf_nvs_partition_gen']

const NVS_GENERATOR_GUIDANCE =
  'Run `pip install esp-idf-nvs-partition-gen` (into the same interpreter as the `python3` on PATH), ' +
  'or set NVS_PARTITION_GEN to nvs_partition_gen.py from a full ESP-IDF checkout to use that instead.'

const nvsGeneratorError = (override: string | undefined, cause: unknown) =>
  new Error(
    override
      ? `NVS_PARTITION_GEN (${override}) could not be run by python3. ${NVS_GENERATOR_GUIDANCE}`
      : `esp_idf_nvs_partition_gen is not installed. ${NVS_GENERATOR_GUIDANCE}`,
    { cause },
  )

// Probed *before* registerDevice() inserts, for the same reason the flag is
// parsed before it. On the --emit-nvs path the secret is deliberately never
// printed, so a generator that cannot run would otherwise leave the secret
// nowhere but the database — unrecoverable — and the obvious re-run would mint
// a second pair, orphaning the first row. `--help` is a cheap harmless probe
// that exercises the same interpreter and module resolution the real call
// uses; it is not worth distinguishing every way the generator can fail.
const assertNvsGeneratorRunnable = () => {
  const override = process.env.NVS_PARTITION_GEN
  try {
    execFileSync('python3', [...nvsGeneratorArgs(override), '--help'], {
      stdio: 'ignore',
    })
  } catch (cause) {
    throw nvsGeneratorError(override, cause)
  }
}

const emitNvsImage = (id: string, secret: string, outPath: string) => {
  const csvPath = `${outPath}.csv`
  writeFileSync(csvPath, buildNvsCsv(id, secret), { mode: 0o600 })
  // writeFileSync's `mode` is only honoured when it creates the file, so a
  // leftover csv from an earlier run would keep whatever permissions it had.
  chmodSync(csvPath, 0o600)

  const override = process.env.NVS_PARTITION_GEN
  const args = [
    ...nvsGeneratorArgs(override),
    'generate',
    csvPath,
    outPath,
    NVS_PARTITION_SIZE,
  ]

  try {
    execFileSync('python3', args, { stdio: 'inherit' })
  } catch (cause) {
    // Don't try to distinguish every possible failure - just replace the raw
    // traceback with actionable guidance. The availability probe already ran
    // before the insert, so reaching here means the generator started and then
    // failed on this input.
    throw nvsGeneratorError(override, cause)
  } finally {
    // The CSV is only ever a transient input to the generator - nobody
    // needs it afterwards, success or failure - so it is removed
    // unconditionally here rather than relying on a printed reminder that
    // only ever ran after a successful generate. The common failure mode
    // (module not installed) threw before that reminder was reached, which
    // left the plaintext secret on disk with nothing telling the user it
    // was there.
    try {
      unlinkSync(csvPath)
    } catch {
      // Best-effort: a cleanup failure here must not shadow the generator's
      // error above, which is the one the user actually needs to see.
    }
  }

  // Only reached when the generator succeeded (the catch above rethrows).
  // The image holds the same plaintext secret as the csv, so it gets the same
  // owner-only permissions instead of whatever the ambient umask allowed.
  chmodSync(outPath, 0o600)
}

const EMIT_FLAG = '--emit-nvs'

// Both `--emit-nvs <path>` and `--emit-nvs=<path>` work. The equals form used
// to miss entirely, leaving nvsPath null and printing the plaintext secret to
// the console - the opposite of what the flag asks for. A flag with no usable
// path is an error for the same reason: falling back to printing the secret
// is never the safer guess.
const resolveNvsPath = (argv: readonly string[]): string | null => {
  const inline = argv.find((arg) => arg.startsWith(`${EMIT_FLAG}=`))
  if (inline !== undefined) {
    const value = inline.slice(EMIT_FLAG.length + 1)
    if (!value) throw new Error(`${EMIT_FLAG}= needs a path`)
    return value
  }

  const index = argv.indexOf(EMIT_FLAG)
  if (index === -1) return null

  // A following token that looks like a flag means the path was forgotten;
  // writing the image to a file called `--force` helps nobody.
  const next = argv[index + 1]
  if (next === undefined || next.startsWith('-')) {
    throw new Error(`${EMIT_FLAG} needs a path, e.g. ${EMIT_FLAG} /tmp/nvs.bin`)
  }
  return next
}

// Parsed before the insert so a usage error doesn't leave a devices row behind.
const nvsPath = resolveNvsPath(process.argv.slice(2))

// Same discipline, extended to the environment: an unusable generator is an
// error about *this* machine, not about the device, so it must surface before
// anything is committed.
if (nvsPath) assertNvsGeneratorRunnable()

const { deviceId, secret } = await registerDevice()

console.error('\nDevice added (unregistered).')
console.error(`  DEVICE_ID = ${deviceId}`)

if (!nvsPath) {
  // The secret only goes to stderr, never stdout, so a plain `> file`
  // redirect can't silently capture it (an explicit `2>` still would).
  console.error(`  DEVICE_SECRET = ${secret}`)
  console.error(
    '\nPass --emit-nvs <path> to write a flashable NVS image instead.\n',
  )
} else {
  emitNvsImage(deviceId, secret, nvsPath)
  console.error(`\nWrote ${nvsPath}. Flash it to a CLEAN device with:`)
  console.error(
    `  esptool.py --port /dev/cu.usbserial-10 write_flash 0x9000 ${nvsPath}\n`,
  )
  console.error(
    'This erases the whole NVS partition, including saved WiFi credentials.\n' +
      `Delete ${nvsPath} once flashed - it holds the secret.\n`,
  )
}
