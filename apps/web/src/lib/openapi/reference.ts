import { ApiReference } from '@scalar/nextjs-api-reference'
import { API_VERSIONS } from '@ws/shared'
import type { ApiVersion } from '@ws/shared'

import { API_VERSION_META } from '@/lib/openapi/versions'

/**
 * A Scalar reference page scoped to `current`, listing every served version in
 * its document dropdown.
 *
 * Each version keeps a permanent URL at `/api/{version}/docs` (bookmarkable,
 * and deleted along with the version when it retires), while the dropdown means
 * a reader who lands on an old version can still reach the current one. The
 * label carries the spec semver, so a `1.0.1` patch of v1 is visible even
 * though the path stays `/api/v1`.
 *
 * Scalar renders a self-contained HTML page that fetches each spec at request
 * time — no client-side React hydration, which is why it works here where
 * swagger-ui-react did not (its apidom OpenAPI-3.1 resolver breaks under
 * Turbopack: "OpenApi3_1Element.refract is not a function").
 */
export const createVersionedReference = (current: ApiVersion) =>
  ApiReference({
    sources: API_VERSIONS.map((version) => {
      const { specVersion, status } = API_VERSION_META[version]
      const suffix = status === 'current' ? '' : ` — ${status}`

      return {
        url: `/api/${version}/openapi.json`,
        title: `${version} · ${specVersion}${suffix}`,
        slug: version,
        default: version === current,
      }
    }),
  })
