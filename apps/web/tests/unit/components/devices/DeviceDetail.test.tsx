/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'
import type { DeviceRole } from '@ws/shared'

const devices: { data: unknown[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
}
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}))
jest.mock('@/services/devices/devices.queries', () => ({
  useMyDevicesQuery: () => devices,
  useDeviceMembersQuery: () => ({ data: [], isLoading: false }),
  useDeviceMemberProfilesQuery: () => ({ data: {}, isLoading: false }),
}))
jest.mock('@/services/users/users.queries', () => ({
  useCurrentUserQuery: () => ({ data: { id: 'u1' }, isLoading: false }),
  userKeys: { all: ['users'], current: ['users', 'current'] },
}))
// Both dialogs own mutation hooks and a Toast context that this file has no
// interest in; the assertions are about which controls the role earns.
jest.mock('@/components/devices/DeviceProfileDialog', () => ({
  DeviceProfileDialog: () => null,
}))
jest.mock('@/components/devices/ShareDialog', () => ({
  ShareDialog: () => null,
}))
jest.mock('@/components/devices/MembersList', () => ({
  MembersList: () => null,
}))

import { DeviceDetail } from '@/components/devices/DeviceDetail'

const asRole = (role: DeviceRole) => {
  devices.data = [
    {
      deviceId: 'ws-1',
      role,
      addedAt: '2026-08-01T00:00:00Z',
      device: {
        status: 'registered',
        createdAt: '2026-08-01T00:00:00Z',
        label: null,
        address: null,
        latitude: null,
        longitude: null,
      },
    },
  ]
  render(<DeviceDetail testId="dd" deviceId="ws-1" />)
}

// The half of the split a user actually experiences. Deleting `editor` from
// canEditDeviceProfile, or widening canManageDeviceMembers, has to fail here —
// before this existed both were invisible to the suite, and the same blind spot
// let the third copy of the predicate in DevicesIndex go unnoticed.
describe('DeviceDetail role gating', () => {
  it('gives an owner both authorities', () => {
    asRole('owner')
    expect(screen.getByTestId('dd-edit')).toBeInTheDocument()
    expect(screen.getByTestId('dd-share')).toBeInTheDocument()
  })

  it('gives an editor station details but not membership', () => {
    asRole('editor')
    expect(screen.getByTestId('dd-edit')).toBeInTheDocument()
    expect(screen.queryByTestId('dd-share')).not.toBeInTheDocument()
  })

  it('gives a viewer neither', () => {
    asRole('viewer')
    expect(screen.queryByTestId('dd-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dd-share')).not.toBeInTheDocument()
  })
})
