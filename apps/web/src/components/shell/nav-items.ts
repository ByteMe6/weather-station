export interface NavItem {
  href: string
  label: string
  key: string
}

/** Plan 2 appends Alerts and Devices when those routes exist (spec §2.1). */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { key: 'alerts', href: '/alerts', label: 'Alerts' },
  { key: 'devices', href: '/devices', label: 'Devices' },
  { key: 'settings', href: '/settings', label: 'Settings' },
]

/** Rendered only when the session's active org is the admin org. */
export const ADMIN_NAV_ITEM: NavItem = {
  key: 'admin',
  href: '/admin',
  label: 'Admin',
}
