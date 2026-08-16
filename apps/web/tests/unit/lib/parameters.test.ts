import { PARAMETERS, parameterMeta } from '@/lib/parameters'

describe('parameters', () => {
  it('lists six parameters in display order with units', () => {
    expect(PARAMETERS.map((p) => p.key)).toEqual([
      'temperature',
      'humidity',
      'pressure',
      'windSpeed',
      'windDirection',
      'precipitation',
    ])
    expect(parameterMeta('pressure')).toMatchObject({
      unit: 'hPa',
      decimals: 1,
      accent: 'press',
    })
  })
})
