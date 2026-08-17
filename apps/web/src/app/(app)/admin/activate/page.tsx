import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { ActivateAdminOrg } from '@/components/admin/ActivateAdminOrg'

export const metadata: Metadata = { title: 'Admin' }

const AdminActivatePage = (): ReactElement => (
  <ActivateAdminOrg testId="admin-activate" />
)

export default AdminActivatePage
