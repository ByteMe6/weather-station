import { isValidTime, normaliseTime, WEEKDAYS } from '@/lib/schedule'

describe('schedule helpers', () => {
  it('validates and normalises times', () => {
    expect(isValidTime('07:30')).toBe(true)
    expect(isValidTime('24:00')).toBe(false)
    expect(normaliseTime('7:30')).toBe('07:30')
    expect(normaliseTime('07:30:00')).toBe('07:30')
  })
  it('lists ISO weekdays Monday first', () => {
    expect(WEEKDAYS[0]).toEqual({ value: 1, short: 'Mon' })
    expect(WEEKDAYS[6]).toEqual({ value: 7, short: 'Sun' })
  })
})
