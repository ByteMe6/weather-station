/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { PrivacyPolicy } from '@/components/legal/PrivacyPolicy'

describe('PrivacyPolicy', () => {
  it.each([
    'What we collect',
    'Why we collect it',
    'How long we keep it',
    'Who can see it',
    'Your rights',
    'Contact',
  ])('has section "%s"', (title) => {
    render(<PrivacyPolicy testId="pp" />)
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  })

  it('says an owner of a station you are on can see your email address', () => {
    render(<PrivacyPolicy testId="pp" />)
    expect(
      screen.getByText(/owner.*can see your email address/i),
    ).toBeInTheDocument()
  })
})
