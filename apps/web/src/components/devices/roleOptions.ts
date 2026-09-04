import type { DeviceRole } from '@ws/shared'

/**
 * One table, two renderings. The capability text used to be duplicated as
 * literals in ShareDialog and MembersList, so a capability change had to find
 * both and nothing connected them — the share dialog promised "Editor" beside
 * "Viewer — can see readings" while the two roles were identical in fact.
 *
 * `capability` is omitted in the per-row Select, where the fuller wording wraps.
 */
interface RoleOption {
  value: DeviceRole
  label: string
  capability: string | null
}

const ROLES: RoleOption[] = [
  { value: 'viewer', label: 'Viewer', capability: 'can see readings' },
  {
    value: 'editor',
    label: 'Editor',
    capability: 'can also edit station details',
  },
  { value: 'owner', label: 'Owner', capability: 'can share and manage' },
]

/** Ascending authority, with the capability spelled out. For the share dialog. */
export const ROLE_OPTIONS_WITH_CAPABILITY: {
  value: DeviceRole
  label: string
}[] = ROLES.map((r) => ({
  value: r.value,
  label: r.capability ? `${r.label} — ${r.capability}` : r.label,
}))

/** Descending authority, names only. For the per-member Select. */
export const ROLE_OPTIONS_COMPACT: { value: DeviceRole; label: string }[] = [
  ...ROLES,
]
  .reverse()
  .map((r) => ({ value: r.value, label: r.label }))
