import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

describe('areDocsEnabled', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  // On in production since the public station API (spec 2026-10-01): users
  // writing scripts need the reference.
  it.each([
    ['locally', undefined],
    ['in preview', 'preview'],
    ['in production', 'production'],
  ])('is enabled %s by default', (_label, vercelEnv) => {
    if (vercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = vercelEnv
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('is disabled by API_DOCS_ENABLED=false', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'false'
    expect(areDocsEnabled()).toBe(false)
  })

  it('ignores values other than "false"', () => {
    process.env.API_DOCS_ENABLED = 'nope'
    expect(areDocsEnabled()).toBe(true)
  })
})
