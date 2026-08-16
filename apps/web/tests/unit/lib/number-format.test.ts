import { formatNumber } from '@/lib/number-format'

describe('formatNumber', () => {
  it('fixes decimals and uses an em dash for non-finite', () => {
    expect(formatNumber(21.44, 1)).toBe('21.4')
    expect(formatNumber(1013, 1)).toBe('1013.0')
    expect(formatNumber(58, 0)).toBe('58')
    expect(formatNumber(Number.NaN, 1)).toBe('—')
  })
})
