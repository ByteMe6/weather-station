/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

const status: { data: unknown } = { data: undefined }
jest.mock('@/services/admin/admin.queries', () => ({
  useAdminStatusQuery: () => status,
}))

import { ConfigMismatchBanner } from '@/components/admin/ConfigMismatchBanner'

describe('ConfigMismatchBanner', () => {
  it('says nothing when the two stores agree', () => {
    status.data = {
      state: 'ok',
      configMismatch: false,
      configUnavailable: false,
    }
    render(<ConfigMismatchBanner testId="banner" />)
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('banner-unavailable')).not.toBeInTheDocument()
  })

  it('reports real drift with the fix instruction', () => {
    status.data = {
      state: 'ok',
      configMismatch: true,
      configUnavailable: false,
    }
    render(<ConfigMismatchBanner testId="banner" />)
    expect(screen.getByTestId('banner')).toHaveTextContent('admin:set-org')
  })

  it('does not claim drift when the vault could not be read', () => {
    // Sending the operator after a config problem that does not exist is worse
    // than saying "couldn't verify".
    status.data = {
      state: 'ok',
      configMismatch: false,
      configUnavailable: true,
    }
    render(<ConfigMismatchBanner testId="banner" />)
    expect(screen.getByTestId('banner-unavailable')).toHaveTextContent(
      "Couldn't verify",
    )
    expect(screen.queryByTestId('banner')).not.toBeInTheDocument()
  })
})
