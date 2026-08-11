import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { API_VERSIONS } from '@ws/shared'

/**
 * Guards the gap between the filesystem and the version registry.
 *
 * Adding `app/api/v2/<endpoint>/route.ts` gives you a working endpoint but does
 * NOT create a documented version — the docs need a spec semver, a status, and
 * OpenAPI operation definitions, none of which the filesystem carries. Without
 * this test that mismatch is silent: the endpoint answers, `/api/v2/reference` 404s,
 * and nothing explains why. These assertions turn it into a named failure.
 */
const API_DIR = join(__dirname, '../../../../src/app/api')

const versionDirs = readdirSync(API_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^v\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

// Widened so `includes` accepts an arbitrary directory name.
const registered: readonly string[] = API_VERSIONS

describe('API version registration', () => {
  it('registers every /api/v* route folder in API_VERSIONS', () => {
    // Fix: add the folder name to API_VERSIONS in @ws/shared, then give it an
    // API_VERSION_META entry and a PATH_REGISTRARS entry. See /new-api-version.
    expect(versionDirs.filter((dir) => !registered.includes(dir))).toEqual([])
  })

  it('has a route folder for every API_VERSIONS entry', () => {
    expect(API_VERSIONS.filter((v) => !versionDirs.includes(v))).toEqual([])
  })

  it.each(API_VERSIONS)('exposes a docs page and a spec for %s', (version) => {
    expect(existsSync(join(API_DIR, version, 'reference', 'route.ts'))).toBe(
      true,
    )
    expect(existsSync(join(API_DIR, version, 'openapi.json', 'route.ts'))).toBe(
      true,
    )
  })
})
