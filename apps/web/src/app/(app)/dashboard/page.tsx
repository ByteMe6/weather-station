import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { DashboardView } from '@/components/dashboard/DashboardView'

export const metadata: Metadata = { title: 'Dashboard' }

const DashboardPage = (): ReactElement => <DashboardView testId="dashboard" />

export default DashboardPage
