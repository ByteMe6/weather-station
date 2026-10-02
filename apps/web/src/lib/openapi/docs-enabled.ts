/**
 * API docs (OpenAPI JSON + Scalar reference) are served everywhere, production
 * included: the key-authenticated station API is for users' own scripts, and
 * they need the reference (spec 2026-10-01). Nothing secret is documented —
 * the ingest entry describes the signing scheme, never a key.
 * `API_DOCS_ENABLED=false` turns them off; any other value leaves them on.
 */
export const areDocsEnabled = (): boolean =>
  process.env.API_DOCS_ENABLED !== 'false'
