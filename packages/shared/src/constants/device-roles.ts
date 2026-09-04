import type { DeviceRole } from '../types'

/**
 * The two authorities on a device, as predicates rather than role lists.
 *
 * They live here, in shared, because the server gate and the UI that offers
 * the control sit on opposite sides of the trust boundary and were previously
 * two independent copies of the same condition. Narrowing the server set then
 * left the button rendering and the dialog submitting, with the action
 * answering FORBIDDEN — which is precisely how `editor` came to be a label the
 * UI offered that granted nothing (MRP-48).
 *
 * The server still decides; these only stop the two from disagreeing about
 * what it decided.
 */

/**
 * Station details — nickname, address, coordinates. A property of the device
 * that every member already sees, so changing it grants nobody access to
 * anything.
 */
export const canEditDeviceProfile = (role: DeviceRole): boolean =>
  role === 'owner' || role === 'editor'

/**
 * Sharing, role changes, removals. Membership *does* grant access, so it stays
 * with the owner: an editor who could share or promote would be an owner under
 * another name.
 */
export const canManageDeviceMembers = (role: DeviceRole): boolean =>
  role === 'owner'
