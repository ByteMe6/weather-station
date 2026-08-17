/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const create = jest.fn<Promise<unknown>, []>()
const invalidate = jest.fn()
jest.mock('@/services/admin/admin.queries', () => ({
  useCreateDeviceMutation: () => ({
    mutateAsync: async () => {
      const res = await create()
      invalidate()
      return res
    },
    isPending: false,
  }),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { CreateDeviceDialog } from '@/components/admin/CreateDeviceDialog'

const SECRET = 'a'.repeat(64)

describe('CreateDeviceDialog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('reveals the secret once and keeps it on screen after the cache is invalidated', async () => {
    // The secret exists in component state and nowhere else: an unmount or a
    // reset here means it is gone for good and the device is unusable.
    create.mockResolvedValue({ deviceId: 'ws-1', secret: SECRET })
    const user = userEvent.setup()
    render(<CreateDeviceDialog testId="cd" open onOpenChange={jest.fn()} />)
    await user.click(screen.getByTestId('cd-submit'))

    await waitFor(() =>
      expect(screen.getByTestId('cd-secret-secret')).toHaveTextContent(SECRET),
    )
    expect(invalidate).toHaveBeenCalled()
    expect(screen.getByTestId('cd-secret-warning')).toHaveTextContent('once')
    // Still there after the invalidation-driven re-render.
    expect(screen.getByTestId('cd-secret-device-id')).toHaveTextContent('ws-1')
  })

  it('does not show a stale secret when the dialog is reopened', async () => {
    create.mockResolvedValue({ deviceId: 'ws-1', secret: SECRET })
    const onOpenChange = jest.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <CreateDeviceDialog testId="cd" open onOpenChange={onOpenChange} />,
    )
    await user.click(screen.getByTestId('cd-submit'))
    await waitFor(() =>
      expect(screen.getByTestId('cd-secret-secret')).toBeInTheDocument(),
    )

    await user.click(screen.getByTestId('cd-done'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(
      <CreateDeviceDialog testId="cd" open onOpenChange={onOpenChange} />,
    )
    expect(screen.queryByTestId('cd-secret-secret')).not.toBeInTheDocument()
    expect(screen.getByTestId('cd-submit')).toBeInTheDocument()
  })

  it('surfaces a failure instead of pretending a device was created', async () => {
    create.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    render(<CreateDeviceDialog testId="cd" open onOpenChange={jest.fn()} />)
    await user.click(screen.getByTestId('cd-submit'))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(screen.queryByTestId('cd-secret-secret')).not.toBeInTheDocument()
  })
})
