import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { DeviceRole } from '@ws/shared'
import { canEditDeviceProfile } from '@ws/shared'

/**
 * The one assertion that actually links the two copies of the profile-edit
 * authority: the predicate in @ws/shared, and the role list inside
 * update_device_profile().
 *
 * Neither suite could see the other before this. pgTAP exercises SQL only, so
 * narrowing canEditDeviceProfile to `owner` left all of its assertions green
 * while the database still permitted editors; widening the SQL list failed
 * pgTAP but nothing reported that TypeScript disagreed. The migration header
 * claimed drift was caught in both directions — it was caught in one.
 *
 * Reading the migration text is deliberate. Anything that asked the database
 * would test the local stack's current state, not the definition this repo
 * ships, and would pass on a machine whose migrations were behind.
 */
const MIGRATION = join(
  __dirname,
  '../../../../../infra/supabase-db/supabase/migrations/20260904065515_device_profile_write_rpc.sql',
)

const ALL_ROLES: DeviceRole[] = ['owner', 'editor', 'viewer']

const rolesAllowedInSql = (): string[] => {
  const sql = readFileSync(MIGRATION, 'utf8')
  // `v_role not in ('owner', 'editor')` — the refusal condition, so the roles
  // it names are exactly the ones the function lets through.
  const list = /v_role not in \(([^)]*)\)/.exec(sql)?.[1]
  if (list === undefined) {
    throw new Error(
      'could not find the role list in update_device_profile; if the guard was ' +
        'restructured, update this parser rather than deleting the test',
    )
  }
  return [...list.matchAll(/'([^']+)'/g)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  )
}

describe('update_device_profile role list vs canEditDeviceProfile', () => {
  it('permits exactly the roles the shared predicate permits', () => {
    const sqlRoles = rolesAllowedInSql().sort()
    const tsRoles = ALL_ROLES.filter(canEditDeviceProfile).sort()
    expect(sqlRoles).toEqual(tsRoles)
  })

  it('names only roles that exist', () => {
    for (const role of rolesAllowedInSql()) {
      expect(ALL_ROLES).toContain(role)
    }
  })
})
