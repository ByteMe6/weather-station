import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { preflight } from '@/lib/api/respond'
import { apiKeyHandlerOptions } from '@/lib/api/with-api-key'

jest.mock('@ws/supabase-db', () => ({ createServiceRoleClient: jest.fn() }))

/**
 * Every station route runs on the service-role client, so a handler exported
 * without withApiKey would be an unauthenticated read of the whole database.
 * This walks the folder instead of listing routes, so a new route.ts is
 * covered the moment it exists.
 */
const WEB = join(__dirname, '../../../../../..')
const STATIONS_DIR = join(WEB, 'src/app/api/v1/stations')
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
// Any own-*/clerk-* module (provider or key-format helpers) is implementation
// detail. Matches `keys/own-…` so relative imports (`./keys/own-provider`) and
// alias imports (`@/lib/api/keys/own-provider`) are both caught.
const CONCRETE_PROVIDER = /keys\/(own|clerk)-/
const SRC = join(WEB, 'src')
const KEYS_DIR = join(SRC, 'lib/api/keys')

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      return full === KEYS_DIR ? [] : sourceFiles(full)
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? routeFiles(join(dir, entry.name))
      : /^route\.(ts|tsx|js)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  )

const files = routeFiles(STATIONS_DIR).map(
  (file) => [relative(STATIONS_DIR, file), file] as const,
)

describe('station API routes', () => {
  it('finds all five route files', () => {
    expect(files).toHaveLength(5)
  })

  it.each(files)(
    '%s: every handler is wrapped in withApiKey, with the right options',
    async (_name, file) => {
      const mod = (await import(file)) as Record<string, unknown>
      const exported = METHODS.filter((m) => mod[m] !== undefined)
      expect(exported.length).toBeGreaterThan(0)
      for (const method of exported) {
        const options = apiKeyHandlerOptions(mod[method])
        // Reads: read scope, CORS on. Writes: read_write scope, CORS off —
        // a write key must never be usable from browser JavaScript.
        const expected =
          method === 'GET' || method === 'HEAD'
            ? { scope: 'read', cors: true }
            : { scope: 'read_write', cors: false }
        expect([method, options]).toEqual([method, expected])
      }
      expect(mod.OPTIONS).toBe(preflight)
    },
  )

  // The membership gate: without it a key could read any station by id.
  it.each(files.filter(([name]) => name.includes('[stationId]')))(
    '%s: calls requireStation',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).toContain('requireStation(')
    },
  )

  it('/stations itself needs no requireStation (it lists by user id)', () => {
    const list = files.filter(([name]) => !name.includes('['))
    expect(list).toHaveLength(1)
    for (const [, file] of list) {
      expect(readFileSync(file, 'utf8')).not.toContain('requireStation(')
    }
  })

  // Whole-tree guard: only lib/api/keys/ itself may name a concrete provider,
  // so swapping providers is a change to getApiKeyProvider() alone.
  it('no file outside lib/api/keys/ references a concrete key provider', () => {
    const all = sourceFiles(SRC)
    expect(all.length).toBeGreaterThan(50)
    const offenders = all
      .filter((file) => CONCRETE_PROVIDER.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(offenders).toEqual([])
  })
})
