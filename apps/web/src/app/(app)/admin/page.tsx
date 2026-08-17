import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { AdminDevicesTable } from '@/components/admin/AdminDevicesTable'
import { ConfigMismatchBanner } from '@/components/admin/ConfigMismatchBanner'

export const metadata: Metadata = { title: 'Admin · Fleet' }

const AdminDevicesPage = (): ReactElement => (
  <>
    <ConfigMismatchBanner testId="admin-config-banner" />
    <AdminDevicesTable testId="admin-fleet" />
  </>
)

export default AdminDevicesPage
