import { ApiReference } from '@scalar/nextjs-api-reference'
import { API_VERSIONS } from '@ws/shared'

import { createVersionedReference } from '@/lib/openapi/reference'
import { API_VERSION_META } from '@/lib/openapi/versions'

jest.mock('@scalar/nextjs-api-reference', () => ({
  ApiReference: jest.fn(() => () => new Response('<html lang="en"></html>')),
}))

const apiReferenceMock = ApiReference as jest.MockedFunction<
  typeof ApiReference
>

const sourcesFor = (current: (typeof API_VERSIONS)[number]) => {
  apiReferenceMock.mockClear()
  createVersionedReference(current)
  return apiReferenceMock.mock.calls[0]?.[0]?.sources ?? []
}

describe('createVersionedReference', () => {
  it('offers every served version in the document switcher', () => {
    const sources = sourcesFor('v1')
    expect(sources.map((source) => source.slug)).toEqual([...API_VERSIONS])
  })

  it("points each source at that version's own spec endpoint", () => {
    for (const source of sourcesFor('v1')) {
      expect(source.url).toBe(`/api/${source.slug}/openapi.json`)
    }
  })

  // Surfacing the semver in the label is how a v1.0.1 patch stays visible to
  // readers even though the path never leaves /api/v1.
  it('labels each source with its spec semver', () => {
    for (const source of sourcesFor('v1')) {
      const version = source.slug as (typeof API_VERSIONS)[number]
      expect(source.title).toContain(API_VERSION_META[version].specVersion)
      expect(source.title).toContain(version)
    }
  })

  it.each(API_VERSIONS)(
    'defaults to %s when that is the current page',
    (version) => {
      const defaulted = sourcesFor(version).filter((source) => source.default)
      expect(defaulted).toHaveLength(1)
      expect(defaulted[0]?.slug).toBe(version)
    },
  )
})
