import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { FIXTURES_FILE } from './paths'

export interface Fixtures {
  deviceId: string
}

export const readFixtures = (): Fixtures =>
  JSON.parse(readFileSync(FIXTURES_FILE, 'utf8')) as Fixtures

/**
 * PostgREST over plain `fetch` rather than supabase-js: Playwright's TypeScript
 * loader resolves `@supabase/supabase-js` to its ESM sources and dies with
 * "Unexpected module status 3" inside this `"type": "module"` package. Four
 * table writes do not justify fighting that.
 */
const rest = async (
  table: string,
  rows: unknown,
  options: { onConflict: string; returning?: boolean },
): Promise<unknown[]> => {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      'Set SUPABASE_URL and SUPABASE_SECRET_KEY (npx supabase status).',
    )
  }
  const prefer = [
    'resolution=merge-duplicates',
    options.returning ? 'return=representation' : 'return=minimal',
  ].join(',')
  const res = await fetch(
    `${url}/rest/v1/${table}?on_conflict=${options.onConflict}`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: JSON.stringify(rows),
    },
  )
  if (!res.ok) {
    throw new Error(`seed ${table} failed: ${res.status} ${await res.text()}`)
  }
  return options.returning ? ((await res.json()) as unknown[]) : []
}

/**
 * A device the suite owns outright. Depending on whatever happens to be in the
 * local database would make these specs order-dependent and fragile.
 */
export const seedDevice = async (clerkUserId: string): Promise<Fixtures> => {
  const deviceId = 'ws-e2e00000001'

  await rest(
    'devices',
    {
      device_id: deviceId,
      secret: 'e2e-not-a-real-secret',
      status: 'registered',
    },
    { onConflict: 'device_id' },
  )

  const users = await rest(
    'users',
    { clerk_user_id: clerkUserId },
    { onConflict: 'clerk_user_id', returning: true },
  )
  const userId = (users[0] as { id?: string } | undefined)?.id
  if (!userId) throw new Error('could not resolve the test users row')

  await rest(
    'device_users',
    { device_id: deviceId, user_id: userId, role: 'owner' },
    { onConflict: 'device_id,user_id' },
  )

  // A few readings so the dashboard and chart render content, not empty states.
  const now = Date.now()
  await rest(
    'readings',
    Array.from({ length: 24 }, (_, i) => ({
      device_id: deviceId,
      timestamp: new Date(now - i * 3_600_000).toISOString(),
      temperature: 20 + i * 0.1,
      humidity: 50,
      pressure: 1013,
      wind_speed: 3,
      wind_direction: 180,
      precipitation: 0,
    })),
    { onConflict: 'device_id,timestamp' },
  )

  mkdirSync(path.dirname(FIXTURES_FILE), { recursive: true })
  writeFileSync(FIXTURES_FILE, JSON.stringify({ deviceId }))
  return { deviceId }
}
