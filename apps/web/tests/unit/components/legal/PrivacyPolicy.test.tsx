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
})
