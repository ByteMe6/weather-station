/**
 * API docs (OpenAPI JSON + Swagger UI) are exposed everywhere except
 * production. `VERCEL_ENV` is 'production' | 'preview' | 'development' on Vercel
 * and undefined locally. `API_DOCS_ENABLED=true|false` overrides.
 */
export const areDocsEnabled = (): boolean => {
  const override = process.env.API_DOCS_ENABLED
  if (override === 'true') return true
  if (override === 'false') return false
  return process.env.VERCEL_ENV !== 'production'
}
