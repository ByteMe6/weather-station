/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { FreshnessPulse } from '@/components/motion/FreshnessPulse'
import { NumberRoll } from '@/components/motion/NumberRoll'
import { fadeUp, springs, stagger } from '@/components/motion/variants'

describe('motion helpers', () => {
  it('springs never overshoot', () => {
    expect(springs.default.bounce).toBe(0)
    expect(springs.snappy.bounce).toBe(0)
    expect(fadeUp.hidden).toMatchObject({ opacity: 0, y: 12 })
    expect(stagger.visible).toMatchObject({
      transition: { staggerChildren: 0.06 },
    })
  })

  it('NumberRoll renders the formatted value and an em dash for null', () => {
    const { rerender } = render(
      <NumberRoll testId="n" value={21.44} decimals={1} />,
    )
    expect(screen.getByTestId('n')).toHaveTextContent('21.4')
    rerender(<NumberRoll testId="n" value={null} decimals={1} />)
    expect(screen.getByTestId('n')).toHaveTextContent('—')
  })

  it('FreshnessPulse exposes its status', () => {
    render(<FreshnessPulse testId="p" status="live" />)
    expect(screen.getByTestId('p')).toHaveAttribute('data-status', 'live')
  })
})
