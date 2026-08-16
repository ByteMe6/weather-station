import { adminOrgId, isAdminOrg } from '@/lib/admin/org'

describe('admin org', () => {
  const original = process.env.ADMIN_ORG_ID
  afterEach(() => {
    process.env.ADMIN_ORG_ID = original
  })

  it('is nobody when ADMIN_ORG_ID is unset or blank', () => {
    delete process.env.ADMIN_ORG_ID
    expect(adminOrgId()).toBeNull()
    expect(isAdminOrg('org_anything')).toBe(false)
    process.env.ADMIN_ORG_ID = '   '
    expect(adminOrgId()).toBeNull()
    expect(isAdminOrg('org_anything')).toBe(false)
  })

  it('matches only the configured org', () => {
    process.env.ADMIN_ORG_ID = 'org_admin123'
    expect(adminOrgId()).toBe('org_admin123')
    expect(isAdminOrg('org_admin123')).toBe(true)
    expect(isAdminOrg('org_other')).toBe(false)
    expect(isAdminOrg(null)).toBe(false)
    expect(isAdminOrg(undefined)).toBe(false)
  })
})
