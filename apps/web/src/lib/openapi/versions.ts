import type { ApiVersion } from '@ws/shared'

/**
 * Documentation metadata for one served path version.
 *
 * This is the second of the project's two version axes. `ApiVersion` (`v1`,
 * `v2`) is the **path** version and moves only on a breaking contract change;
 * `specVersion` is the **spec** semver published as OpenAPI `info.version` and
 * moves on any change to that version's surface, including patches like
 * `1.0.1`. Keeping them apart is what lets v1 gain a documented field without
 * breaking devices that flashed `/api/v1/readings` into `secrets.ini`.
 */
export type ApiVersionMeta = {
  /** OpenAPI `info.version` — bumped for any change to this version's surface. */
  specVersion: string
  status: 'current' | 'deprecated'
  /** RFC 8594 sunset date (ISO), set when a version is deprecated. */
  sunset?: string
}

export const API_VERSION_META: Record<ApiVersion, ApiVersionMeta> = {
  v1: { specVersion: '1.0.0', status: 'current' },
}
