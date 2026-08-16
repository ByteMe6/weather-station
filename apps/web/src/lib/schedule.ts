export const WEEKDAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 7, short: 'Sun' },
] as const

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** '7:30' → '07:30'; DB `time` values come back as 'HH:MM:SS' → 'HH:MM'. */
export const normaliseTime = (v: string): string => {
  const [h = '', m = ''] = v.split(':')
  return `${h.padStart(2, '0')}:${m.slice(0, 2).padStart(2, '0')}`
}

export const isValidTime = (v: string): boolean =>
  TIME_RE.test(normaliseTime(v))

export const localTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone
