import { ApiReference } from '@scalar/nextjs-api-reference'
import { API_VERSIONS, LATEST_API_VERSION } from '@ws/shared'

import { API_VERSION_META } from '@/lib/openapi/versions'

/**
 * The single Scalar reference page, listing every served version in its
 * document dropdown and opening on `LATEST_API_VERSION`.
 *
 * There is deliberately no per-version reference route. `openapi.json` is the
 * versioned artifact — one document per path version — but the reference is a
 * UI that reads all of them, so it has no version of its own. One page also
 * removes the class of bug where a route cloned for a new version keeps the old
 * version's argument.
 *
 * Scalar routes within the page by URL hash (`#tag/...`) unless `pathRouting`
 * is configured, so no catch-all route is needed and a refresh cannot 404.
 *
 * Scalar renders a self-contained HTML page that fetches each spec at request
 * time — no client-side React hydration, which is why it works here where
 * swagger-ui-react did not (its apidom OpenAPI-3.1 resolver breaks under
 * Turbopack: "OpenApi3_1Element.refract is not a function").
 */
export const createReference = () =>
  ApiReference({
    sources: API_VERSIONS.map((version) => {
      const { specVersion, status } = API_VERSION_META[version]
      const suffix = status === 'current' ? '' : ` — ${status}`

      return {
        url: `/api/${version}/openapi.json`,
        title: `${version} · ${specVersion}${suffix}`,
        slug: version,
        default: version === LATEST_API_VERSION,
      }
    }),
  })
