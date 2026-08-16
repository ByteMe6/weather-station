const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const

export const bearingToCompass = (deg: number): string =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] ?? 'N'

export const formatTime = (
  iso: string,
  opts: { timeZone?: string } = {},
): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: opts.timeZone,
  }).format(new Date(iso))

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))

export const readingAgeMs = (iso: string, now: Date = new Date()): number =>
  now.getTime() - new Date(iso).getTime()

/** Coarse relative label for the freshness eyebrow ("just now", "2 min ago", "2 h ago"). */
export const formatRelative = (iso: string, now: Date = new Date()): string => {
  const ms = readingAgeMs(iso, now)
  if (ms < 45_000) return 'just now'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
