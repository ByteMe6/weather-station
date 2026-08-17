/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import { ShareDialog } from '@/components/devices/ShareDialog'

const shareDeviceAction = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/devices.action', () => ({
  shareDeviceAction: (input: unknown) => shareDeviceAction(input),
}))
const toast = jest.fn()
jest.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast }) }))

const wrap = (ui: ReactElement) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  )

const open = () =>
  wrap(
    <ShareDialog
      testId="share"
      deviceId="ws-1"
      open
      onOpenChange={jest.fn()}
    />,
  )

describe('ShareDialog', () => {
  beforeEach(() => jest.clearAllMocks())

  it('asks for an email address, not a Clerk user ID', () => {
    open()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.queryByText(/clerk/i)).not.toBeInTheDocument()
  })

  it('sends what the owner typed to the share action', async () => {
    shareDeviceAction.mockResolvedValue({ ok: true, data: { userId: 'u-1' } })
    open()
    await userEvent.type(
      screen.getByTestId('share-identifier-input'),
      'ada@example.com',
    )
    await userEvent.click(screen.getByTestId('share-submit'))
    await waitFor(() =>
      expect(shareDeviceAction).toHaveBeenCalledWith({
        deviceId: 'ws-1',
        identifier: 'ada@example.com',
        role: 'viewer',
      }),
    )
  })

  it('shows the field error when the email matches no account', async () => {
    shareDeviceAction.mockResolvedValue({
      ok: false,
      code: 'USER_NOT_FOUND',
      message: 'No Weather Station account uses that email yet',
      fieldErrors: {
        identifier: 'No Weather Station account uses that email yet',
      },
    })
    open()
    await userEvent.type(
      screen.getByTestId('share-identifier-input'),
      'ghost@example.com',
    )
    await userEvent.click(screen.getByTestId('share-submit'))
    expect(
      await screen.findByText('No Weather Station account uses that email yet'),
    ).toBeInTheDocument()
    expect(toast).not.toHaveBeenCalled()
  })
})
