import {
  canEditDeviceProfile,
  canManageDeviceMembers,
} from '../../src/constants/device-roles'
import type { DeviceRole } from '../../src/types'

const ROLES: DeviceRole[] = ['owner', 'editor', 'viewer']

describe('device role predicates', () => {
  // These are the whole reason `editor` means anything. Both the server gates
  // (actions/devices.action.ts) and the controls that offer the action
  // (DeviceDetail, DevicesIndex) call these, so the table below is the single
  // statement of who may do what.
  it.each([
    ['owner', true, true],
    ['editor', true, false],
    ['viewer', false, false],
  ] as const)(
    '%s: editProfile=%s manageMembers=%s',
    (role, editProfile, manageMembers) => {
      expect(canEditDeviceProfile(role)).toBe(editProfile)
      expect(canManageDeviceMembers(role)).toBe(manageMembers)
    },
  )

  // Managing membership is strictly the narrower authority: anyone who may
  // change who has access may certainly rename the station. A future role that
  // broke this would be an owner that cannot edit its own device.
  it('keeps membership management a subset of profile editing', () => {
    for (const role of ROLES) {
      if (canManageDeviceMembers(role))
        expect(canEditDeviceProfile(role)).toBe(true)
    }
  })
})
