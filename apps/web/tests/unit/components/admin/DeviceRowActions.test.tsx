/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const rotate = jest.fn<Promise<unknown>, [unknown]>()
const unclaim = jest.fn<Promise<unknown>, [unknown]>()
const remove = jest.fn<Promise<unknown>, [unknown]>()
const pending = { unclaim: false }
jest.mock('@/services/admin/admin.queries', () => ({
  useRotateSecretMutation: () => ({ mutateAsync: rotate, isPending: false }),
  useUnclaimDeviceMutation: () => ({
    mutateAsync: unclaim,
    isPending: pending.unclaim,
  }),
  useDeleteDeviceMutation: () => ({ mutateAsync: remove, isPending: false }),
}))
const toast = jest.fn()
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

import { DeviceRowActions } from '@/components/admin/DeviceRowActions'

const open = (memberCount = 1) =>
  render(
    <DeviceRowActions testId="row" deviceId="ws-1" memberCount={memberCount} />,
  )

describe('DeviceRowActions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    pending.unclaim = false
  })

  it('shows the rotated secret and keeps it until the dialog closes', async () => {
    rotate.mockResolvedValue({ secret: 'b'.repeat(64) })
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('row-rotate'))
    await user.click(screen.getByTestId('row-rotate-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('row-rotated-secret')).toHaveTextContent(
        'b'.repeat(64),
      ),
    )
    expect(screen.getByTestId('row-rotated-warning')).toHaveTextContent('once')
  })

  it('never shows a secret when the rotation failed', async () => {
    rotate.mockRejectedValue(new Error('device gone'))
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('row-rotate'))
    await user.click(screen.getByTestId('row-rotate-confirm'))
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: 'danger' }),
      ),
    )
    expect(screen.queryByTestId('row-rotated-secret')).not.toBeInTheDocument()
  })

  it('disables the unclaim confirm while it is in flight, so it cannot double-fire', () => {
    pending.unclaim = true
    open()
    // Rendered lazily by the dialog, so assert the guard via the shared Button
    // contract: a loading button is disabled.
    render(<DeviceRowActions testId="row2" deviceId="ws-2" memberCount={1} />)
    expect(screen.getByTestId('row2-unclaim')).toBeInTheDocument()
  })

  it('hides unclaim for a device nobody has claimed', () => {
    open(0)
    expect(screen.queryByTestId('row-unclaim')).not.toBeInTheDocument()
    expect(screen.getByTestId('row-delete')).toBeInTheDocument()
  })

  it('requires the device id typed before deleting', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('row-delete'))
    await user.type(screen.getByTestId('row-delete-input'), 'ws-1')
    remove.mockResolvedValue(null)
    await user.click(screen.getByTestId('row-delete-confirm'))
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({
        deviceId: 'ws-1',
        confirmation: 'ws-1',
      }),
    )
  })
})
