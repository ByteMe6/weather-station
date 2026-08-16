/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { Logo } from '@/components/brand/Logo'

describe('Logo', () => {
  it('renders at the requested size on a 24-unit grid', () => {
    render(<Logo testId="logo" size={40} />)
    const svg = screen.getByTestId('logo')
    expect(svg).toHaveAttribute('width', '40')
    expect(svg).toHaveAttribute('height', '40')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it('swaps to the hinted compact drawing below 24px', () => {
    // The full drawing's inner turn closes on the low at small sizes, so the
    // nav (22px) and favicon must get the simplified one instead.
    const { rerender } = render(<Logo testId="logo" size={22} />)
    expect(screen.getByTestId('logo')).toHaveAttribute(
      'data-drawing',
      'compact',
    )

    rerender(<Logo testId="logo" size={24} />)
    expect(screen.getByTestId('logo')).toHaveAttribute('data-drawing', 'full')
  })

  it('defaults to the full drawing', () => {
    render(<Logo testId="logo" />)
    expect(screen.getByTestId('logo')).toHaveAttribute('data-drawing', 'full')
  })

  it('is hidden from assistive tech when it sits beside a visible wordmark', () => {
    render(<Logo testId="logo" />)
    const svg = screen.getByTestId('logo')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('role', 'img')
  })

  it('is exposed as a named image when it stands alone', () => {
    render(<Logo testId="logo" title="Weather Station" />)
    const svg = screen.getByTestId('logo')
    expect(svg).toHaveAttribute('role', 'img')
    expect(svg).toHaveAttribute('aria-label', 'Weather Station')
    expect(svg).not.toHaveAttribute('aria-hidden')
  })

  it('takes the contour from currentColor and the low from the sky token', () => {
    // Both themes are handled by tokens, not by two drawings — the contour
    // inherits nav text colour and the low uses --color-sky.
    const { container } = render(<Logo testId="logo" />)
    expect(container.querySelector('path')).toHaveAttribute(
      'fill',
      'currentColor',
    )
    expect(container.querySelector('circle')).toHaveClass('fill-sky')
  })
})
