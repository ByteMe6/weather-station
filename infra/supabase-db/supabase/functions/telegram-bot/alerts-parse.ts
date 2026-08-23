// Pure parsing/formatting for alert slots (PRD T5, Flow 2/5 grammar).
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export const parseTime = (raw: string): string | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

const dayIndex = (token: string): number => {
  const i = DAY_NAMES.findIndex(
    (d) => d.toLowerCase() === token.trim().toLowerCase(),
  )
  return i === -1 ? -1 : i + 1
}

export const parseDays = (raw: string): number[] | null => {
  if (!raw.trim()) return null
  const out = new Set<number>()
  for (const token of raw.split(',')) {
    const range = token.split('-')
    if (range.length === 1) {
      const d = dayIndex(range[0])
      if (d === -1) return null
      out.add(d)
    } else if (range.length === 2) {
      const from = dayIndex(range[0])
      const to = dayIndex(range[1])
      if (from === -1 || to === -1 || from >= to) return null
      for (let d = from; d <= to; d++) out.add(d)
    } else return null
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null
}

// Intl.supportedValuesOf omits tzdata aliases (e.g. Europe/Kyiv on ICU builds
// that still canonicalise to Europe/Kiev); constructing a DateTimeFormat
// accepts any valid IANA id and throws RangeError on junk.
export const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const parseAlertAdd = (
  rest: string,
): { time: string; days: number[]; timezone?: string } | { error: string } => {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2)
    return {
      error: 'Usage: /alert add HH:MM Mon,Wed or Mon-Fri [Europe/Kyiv]',
    }
  const time = parseTime(parts[0])
  if (!time)
    return { error: `"${parts[0]}" is not a valid 24-hour HH:MM time.` }
  const days = parseDays(parts[1])
  if (!days)
    return {
      error: `"${parts[1]}" is not a valid day list (e.g. Mon,Wed or Mon-Fri).`,
    }
  if (parts.length === 2) return { time, days }
  if (parts.length === 3) {
    if (!isValidTimezone(parts[2]))
      return {
        error: `"${parts[2]}" is not an IANA timezone (e.g. Europe/Kyiv).`,
      }
    return { time, days, timezone: parts[2] }
  }
  return { error: 'Too many arguments. Usage: /alert add HH:MM <days> [timezone]' }
}

export const daysToBits = (days: number[]): string =>
  DAY_NAMES.map((_, i) => (days.includes(i + 1) ? '1' : '0')).join('')

export const bitsToDays = (bits: string): number[] =>
  [...bits].flatMap((b, i) => (b === '1' ? [i + 1] : []))

export const formatDays = (days: number[]): string => {
  const runs: number[][] = []
  for (const d of days) {
    const last = runs.at(-1)
    if (last && d === last[last.length - 1] + 1) last.push(d)
    else runs.push([d])
  }
  return runs
    .flatMap((run) =>
      run.length >= 3
        ? [`${DAY_NAMES[run[0] - 1]}–${DAY_NAMES[run[run.length - 1] - 1]}`]
        : run.map((d) => DAY_NAMES[d - 1]),
    )
    .join(', ')
}
