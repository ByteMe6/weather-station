/** @jest-environment jsdom */
import { render, waitFor } from '@testing-library/react'

import { notFoundState, routerState } from '../../../stubs/next-navigation'

const status = jest.fn<Promise<unknown>, []>()
jest.mock('@/actions/admin.action', () => ({
  getAdminStatusAction: () => status(),
}))
const setActive = jest.fn<Promise<void>, [unknown]>()
jest.mock('@clerk/nextjs', () => ({
  useClerk: () => ({ setActive }),
}))

import { ActivateAdminOrg } from '@/components/admin/ActivateAdminOrg'

describe('ActivateAdminOrg', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    notFoundState.calls = 0
  })

  it('activates the admin org and continues to the console', async () => {
    status.mockResolvedValue({
      ok: true,
      data: { state: 'needs-activation', orgId: 'org_admin123' },
    })
    render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() =>
      expect(setActive).toHaveBeenCalledWith({ organization: 'org_admin123' }),
    )
    await waitFor(() =>
      expect(routerState.replace).toHaveBeenCalledWith('/admin'),
    )
  })

  it('goes straight through when the org is already active', async () => {
    status.mockResolvedValue({
      ok: true,
      data: { state: 'ok', configMismatch: false },
    })
    render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() =>
      expect(routerState.replace).toHaveBeenCalledWith('/admin'),
    )
    expect(setActive).not.toHaveBeenCalled()
  })

  it('404s a user who is not in the admin org', async () => {
    status.mockResolvedValue({ ok: true, data: { state: 'denied' } })
    // notFound() throws by design; React surfaces it from the render pass.
    const { rerender } = render(<ActivateAdminOrg testId="activate" />)
    await waitFor(() => expect(status).toHaveBeenCalled())
    expect(() => rerender(<ActivateAdminOrg testId="activate" />)).toThrow(
      'NEXT_NOT_FOUND',
    )
    expect(notFoundState.calls).toBeGreaterThan(0)
    expect(routerState.replace).not.toHaveBeenCalled()
  })
})
