export interface NavItem {
  href: string
  label: string
  key: string
}

/** Plan 2 appends Alerts and Devices when those routes exist (spec §2.1). */
export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { key: 'settings', href: '/settings', label: 'Settings' },
]
