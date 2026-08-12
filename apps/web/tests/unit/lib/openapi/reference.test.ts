import { ApiReference } from '@scalar/nextjs-api-reference'
import { API_VERSIONS, LATEST_API_VERSION } from '@ws/shared'

import { createReference } from '@/lib/openapi/reference'
import { API_VERSION_META } from '@/lib/openapi/versions'

jest.mock('@scalar/nextjs-api-reference', () => ({
  ApiReference: jest.fn(() => () => new Response('<html lang="en"></html>')),
}))

const apiReferenceMock = ApiReference as jest.MockedFunction<
  typeof ApiReference
>

const sources = () => {
  apiReferenceMock.mockClear()
  createReference()
  return apiReferenceMock.mock.calls[0]?.[0]?.sources ?? []
}

describe('createReference', () => {
  it('offers every served version in the document switcher', () => {
    expect(sources().map((source) => source.slug)).toEqual([...API_VERSIONS])
  })

  it("points each source at that version's own spec endpoint", () => {
    for (const source of sources()) {
      expect(source.url).toBe(`/api/${source.slug}/openapi.json`)
    }
  })

  // Surfacing the semver in the label is how a v1.0.1 patch stays visible to
  // readers even though the path never leaves /api/v1.
  it('labels each source with its spec semver', () => {
    for (const source of sources()) {
      const version = source.slug as (typeof API_VERSIONS)[number]
      expect(source.title).toContain(API_VERSION_META[version].specVersion)
      expect(source.title).toContain(version)
    }
  })

  it('opens on the recommended version, not merely the newest', () => {
    const defaulted = sources().filter((source) => source.default)
    expect(defaulted).toHaveLength(1)
    expect(defaulted[0]?.slug).toBe(LATEST_API_VERSION)
  })
})
