/**
 * API docs (OpenAPI JSON + Swagger UI) are exposed everywhere except
 * production. `VERCEL_ENV` is 'production' | 'preview' | 'development' on Vercel
 * and undefined locally. `API_DOCS_ENABLED=true|false` overrides.
 */
export const areDocsEnabled = (): boolean => {
  const override = process.env.API_DOCS_ENABLED
  if (override === 'true') return true
  if (override === 'false') return false

  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv) return vercelEnv !== 'production'
  return process.env.NODE_ENV !== 'production'
}
