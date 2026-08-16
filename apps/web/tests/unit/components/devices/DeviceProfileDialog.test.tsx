/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

const update = jest.fn<Promise<unknown>, [unknown]>()
jest.mock('@/actions/devices.action', () => ({
  updateDeviceProfileAction: (i: unknown) => update(i),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { DeviceProfileDialog } from '@/components/devices/DeviceProfileDialog'

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

const open = (
  overrides: Partial<Parameters<typeof DeviceProfileDialog>[0]> = {},
) =>
  wrap(
    <DeviceProfileDialog
      testId="pd"
      deviceId="ws-1"
      label="Backyard"
      address="1 Main St"
      latitude={null}
      longitude={null}
      open
      onOpenChange={jest.fn()}
      {...overrides}
    />,
  )

describe('DeviceProfileDialog coordinates', () => {
  beforeEach(() => jest.clearAllMocks())

  it('prefills existing coordinates with six decimals', () => {
    open({ latitude: 49.8397, longitude: 24.0297 })
    expect(screen.getByTestId('pd-latitude-input')).toHaveValue('49.839700')
    expect(screen.getByTestId('pd-longitude-input')).toHaveValue('24.029700')
  })

  it('splits a pasted "lat, lng" pair across both fields', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByTestId('pd-latitude-input'))
    await user.paste('49.8397, 24.0297')
    expect(screen.getByTestId('pd-latitude-input')).toHaveValue('49.8397')
    expect(screen.getByTestId('pd-longitude-input')).toHaveValue('24.0297')
  })

  it('sends the coordinates as strings and surfaces a field error', async () => {
    update.mockResolvedValue({
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Check the highlighted fields',
      fieldErrors: { latitude: 'latitude must be between -90 and 90' },
    })
    const user = userEvent.setup()
    open()
    await user.type(screen.getByTestId('pd-latitude-input'), '91')
    await user.type(screen.getByTestId('pd-longitude-input'), '24')
    await user.click(screen.getByTestId('pd-save'))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        deviceId: 'ws-1',
        label: 'Backyard',
        address: '1 Main St',
        latitude: '91',
        longitude: '24',
      }),
    )
    expect(await screen.findByTestId('pd-latitude-error')).toHaveTextContent(
      'between -90 and 90',
    )
  })
})
