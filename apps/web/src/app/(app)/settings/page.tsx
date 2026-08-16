import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { AppearanceCard } from '@/components/settings/AppearanceCard'
import { TelegramCard } from '@/components/settings/TelegramCard'

export const metadata: Metadata = { title: 'Settings' }

const SettingsPage = (): ReactElement => (
  <div className="flex flex-col gap-4">
    <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
    <AppearanceCard testId="settings-appearance" />
    <TelegramCard testId="settings-telegram" />
  </div>
)

export default SettingsPage
