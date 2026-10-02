import { API_VERSIONS } from '@ws/shared'

import { buildOpenApiDocument } from '@/lib/openapi/document'
import { API_VERSION_META } from '@/lib/openapi/versions'

describe('buildOpenApiDocument', () => {
  it.each(API_VERSIONS)(
    'scopes %s operations to its own server prefix',
    (version) => {
      const doc = buildOpenApiDocument(version)
      expect(doc.servers?.[0]?.url).toBe(`/api/${version}`)
    },
  )

  // The two version axes: the path stays major-only while info.version carries
  // the semver, so a v1 patch release never moves /api/v1.
  it.each(API_VERSIONS)(
    'publishes the %s spec semver as info.version, not the path version',
    (version) => {
      const doc = buildOpenApiDocument(version)
      expect(doc.info.version).toBe(API_VERSION_META[version].specVersion)
      expect(doc.info.version).not.toBe(version)
    },
  )

  it.each(API_VERSIONS)(
    'registers a documented operation set for %s',
    (version) => {
      const doc = buildOpenApiDocument(version)
      expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(0)
    },
  )

  it('documents the v1 ingest and health operations', () => {
    const doc = buildOpenApiDocument('v1')
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths?.['/readings']).toBeDefined()
    expect(doc.paths?.['/health']).toBeDefined()
  })

  it('documents the key-authenticated station API in v1', () => {
    const doc = buildOpenApiDocument('v1')
    expect(API_VERSION_META.v1.specVersion).toBe('1.1.0')
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
    expect(Object.keys(doc.paths ?? {})).toEqual(
      expect.arrayContaining([
        '/stations',
        '/stations/{stationId}',
        '/stations/{stationId}/readings',
        '/stations/{stationId}/readings/latest',
        '/stations/{stationId}/readings/aggregate',
      ]),
    )
    expect(doc.paths?.['/stations/{stationId}']?.patch).toBeDefined()
    expect(
      doc.paths?.['/stations/{stationId}']?.patch?.requestBody,
    ).toMatchObject({ required: true })
    expect(
      doc.paths?.['/stations/{stationId}/readings']?.get?.description,
    ).toContain('1–1000')
    expect(doc.paths?.['/stations']?.get?.security).toEqual([
      { bearerAuth: [] },
    ])
  })
})
