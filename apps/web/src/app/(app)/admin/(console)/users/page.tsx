import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { AdminUsersTable } from '@/components/admin/AdminUsersTable'

export const metadata: Metadata = { title: 'Admin · Users' }

const AdminUsersPage = (): ReactElement => (
  <AdminUsersTable testId="admin-users" />
)

export default AdminUsersPage
