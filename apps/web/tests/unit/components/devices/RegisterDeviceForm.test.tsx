/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { routerState } from '../../../stubs/next-navigation'

const register = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/devices.action', () => ({
  registerDeviceAction: (i: unknown) => register(i),
}))
const toast = jest.fn()
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))
const invalidate = jest.fn()
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}))

import { RegisterDeviceForm } from '@/components/devices/RegisterDeviceForm'

describe('RegisterDeviceForm', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows the not-found error inline', async () => {
    register.mockResolvedValue({
      ok: false,
      code: 'DEVICE_NOT_FOUND',
      message: "We don't recognise that ID — check the label",
      fieldErrors: { deviceId: "We don't recognise that ID — check the label" },
    })
    const user = userEvent.setup()
    render(<RegisterDeviceForm testId="reg" />)
    await user.type(screen.getByTestId('reg-input'), 'ws-nope')
    await user.click(screen.getByTestId('reg-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('reg-field-error')).toHaveTextContent(
        "don't recognise",
      ),
    )
  })

  it('redirects to the dashboard on success', async () => {
    register.mockResolvedValue({
      ok: true,
      data: { deviceId: 'ws-3f2a9b7c1d0e' },
    })
    const user = userEvent.setup()
    render(<RegisterDeviceForm testId="reg" />)
    await user.type(screen.getByTestId('reg-input'), 'ws-3f2a9b7c1d0e')
    await user.click(screen.getByTestId('reg-submit'))
    await waitFor(() =>
      expect(routerState.replace).toHaveBeenCalledWith('/dashboard'),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Station registered' }),
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['devices'] })
  })
})
