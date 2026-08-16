/**
 * Admin identity is a single Clerk organization id. It is read from the
 * environment here (proxy + server actions) and from Supabase Vault by RLS;
 * both must hold the same value, which getAdminStatusAction() cross-checks.
 *
 * No `server-only` import: the proxy imports this too, and an unset or blank
 * value means "there is no admin org", so every check fails closed.
 */
export const adminOrgId = (): string | null => {
  const value = process.env.ADMIN_ORG_ID?.trim()
  return value ? value : null
}

export const isAdminOrg = (orgId: string | null | undefined): boolean => {
  const configured = adminOrgId()
  return configured !== null && orgId === configured
}
