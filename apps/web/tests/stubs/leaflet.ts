/* Test stub for `leaflet`: only the pieces StationMap touches. */
export const divIcon = (options: unknown): unknown => options
export const latLngBounds = (
  coords: [number, number][],
): { isValid: () => boolean } => ({ isValid: () => coords.length > 0 })
