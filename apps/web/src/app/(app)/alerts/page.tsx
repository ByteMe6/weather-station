import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { AlertsView } from '@/components/alerts/AlertsView'

export const metadata: Metadata = { title: 'Alerts' }

const AlertsPage = (): ReactElement => (
  <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
    <AlertsView testId="alerts" />
  </div>
)

export default AlertsPage
