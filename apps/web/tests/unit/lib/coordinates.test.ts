import { formatCoordinate, parseCoordinateInput } from '@/lib/coordinates'

describe('parseCoordinateInput', () => {
  it('passes a single number through untouched', () => {
    expect(parseCoordinateInput('49.8397')).toEqual({ latitude: '49.8397' })
    expect(parseCoordinateInput('  -0.5 ')).toEqual({ latitude: '-0.5' })
  })

  it('splits a pasted "lat, lng" pair across both fields', () => {
    expect(parseCoordinateInput('49.8397, 24.0297')).toEqual({
      latitude: '49.8397',
      longitude: '24.0297',
    })
    expect(parseCoordinateInput('49.8397,24.0297')).toEqual({
      latitude: '49.8397',
      longitude: '24.0297',
    })
    expect(parseCoordinateInput(' -33.8688 , 151.2093 ')).toEqual({
      latitude: '-33.8688',
      longitude: '151.2093',
    })
  })

  it('leaves anything that is not a clean pair alone for the schema to reject', () => {
    expect(parseCoordinateInput('nope')).toEqual({ latitude: 'nope' })
    expect(parseCoordinateInput('1, 2, 3')).toEqual({ latitude: '1, 2, 3' })
    expect(parseCoordinateInput('')).toEqual({ latitude: '' })
  })
})

describe('formatCoordinate', () => {
  it('renders six decimals without exponent notation', () => {
    expect(formatCoordinate(49.8397)).toBe('49.839700')
    expect(formatCoordinate(-0.000001)).toBe('-0.000001')
    // String(0.0000001) would be '1e-7', which no input field should ever show.
    expect(formatCoordinate(0.0000001)).toBe('0.000000')
  })
})
