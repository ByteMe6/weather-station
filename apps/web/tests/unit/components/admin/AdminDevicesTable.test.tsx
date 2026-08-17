/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

const devices: { data: unknown[] | undefined; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
jest.mock('@/services/admin/admin.queries', () => ({
  adminKeys: { all: ['admin'], devices: ['admin', 'devices'] },
  useAdminDevicesQuery: () => devices,
  useCreateDeviceMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRotateSecretMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useUnclaimDeviceMutation: () => ({
    mutateAsync: jest.fn(),
    isPending: false,
  }),
  useDeleteDeviceMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}))
jest.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}))

import { AdminDevicesTable } from '@/components/admin/AdminDevicesTable'
import type { AdminDevice } from '@/services/admin/admin.service'

describe('AdminDevicesTable', () => {
  it('renders a skeleton while loading', () => {
    devices.isLoading = true
    render(<AdminDevicesTable testId="fleet" />)
    expect(screen.getByTestId('fleet-skeleton')).toBeInTheDocument()
  })

  it('renders one row per device and never a secret', () => {
    devices.isLoading = false
    const rows: AdminDevice[] = [
      {
        deviceId: 'ws-1',
        status: 'registered',
        label: 'Backyard',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 2,
      },
      {
        deviceId: 'ws-2',
        status: 'unregistered',
        label: null,
        createdAt: '2026-08-02T00:00:00Z',
        memberCount: 0,
      },
    ]
    devices.data = rows
    render(<AdminDevicesTable testId="fleet" />)
    expect(screen.getByTestId('fleet-row-ws-1')).toHaveTextContent('Backyard')
    expect(screen.getByTestId('fleet-row-ws-2')).toHaveTextContent(
      'unregistered',
    )
    expect(screen.queryByText(/secret/i)).not.toBeInTheDocument()
  })
})
