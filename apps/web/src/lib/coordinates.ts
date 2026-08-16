/**
 * Coordinates are typed by hand (no geocoding service). Copying a pin from a
 * phone or a maps app yields "49.839700, 24.029700" — one string holding both
 * numbers — so pasting that into the latitude field fills in both instead of
 * failing validation. Anything that is not a clean pair is passed through
 * unchanged and rejected later by the action's schema, which owns the error
 * messages.
 */
const NUMBER = /^-?\d+(\.\d+)?$/

export const parseCoordinateInput = (
  raw: string,
): { latitude: string; longitude?: string } => {
  const parts = raw.split(',').map((p) => p.trim())
  if (parts.length === 2 && parts.every((p) => NUMBER.test(p))) {
    return { latitude: parts[0]!, longitude: parts[1]! }
  }
  return { latitude: raw.trim() }
}

/** Six decimals matches the column precision (~0.11 m) and avoids exponent notation. */
export const formatCoordinate = (value: number): string => value.toFixed(6)
