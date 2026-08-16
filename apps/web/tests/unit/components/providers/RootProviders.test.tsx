/** @jest-environment jsdom */
import { useQueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'

jest.mock('@clerk/nextjs', () => ({
  ClerkProvider: ({ children }: { children: ReactElement }) => children,
  useAuth: () => ({ userId: 'user_1', isLoaded: true }),
}))

import { RootProviders } from '@/components/providers/RootProviders'

const Probe = (): ReactElement => {
  const qc = useQueryClient()
  return <div data-testid="probe">{qc ? 'query-ok' : 'no-query'}</div>
}

describe('RootProviders', () => {
  it('provides a query client to children', () => {
    render(
      <RootProviders>
        <Probe />
      </RootProviders>,
    )
    expect(screen.getByTestId('probe')).toHaveTextContent('query-ok')
  })
})
