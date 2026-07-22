import { areDocsEnabled } from '@/lib/openapi/docs-enabled'

describe('areDocsEnabled', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('is enabled locally (VERCEL_ENV unset)', () => {
    delete process.env.VERCEL_ENV
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('is disabled in production', () => {
    process.env.VERCEL_ENV = 'production'
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(false)
  })

  it('is enabled in preview', () => {
    process.env.VERCEL_ENV = 'preview'
    delete process.env.API_DOCS_ENABLED
    expect(areDocsEnabled()).toBe(true)
  })

  it('honors the API_DOCS_ENABLED override in production', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.API_DOCS_ENABLED = 'true'
    expect(areDocsEnabled()).toBe(true)
  })
})
