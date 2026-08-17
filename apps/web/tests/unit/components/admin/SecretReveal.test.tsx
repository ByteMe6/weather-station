/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { SecretReveal } from '@/components/admin/SecretReveal'

describe('SecretReveal', () => {
  it('shows the id and secret with a shown-once warning', () => {
    render(
      <SecretReveal
        testId="reveal"
        deviceId="ws-3f2a9b7c1d0e"
        secret={'a'.repeat(64)}
      />,
    )
    expect(screen.getByTestId('reveal-device-id')).toHaveTextContent(
      'ws-3f2a9b7c1d0e',
    )
    expect(screen.getByTestId('reveal-secret')).toHaveTextContent(
      'a'.repeat(64),
    )
    expect(screen.getByTestId('reveal-warning')).toHaveTextContent('once')
  })
})
