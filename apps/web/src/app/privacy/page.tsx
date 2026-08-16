import type { Metadata } from 'next'
import type { ReactElement } from 'react'

import { LegalFrame } from '@/components/legal/LegalFrame'
import { PrivacyPolicy } from '@/components/legal/PrivacyPolicy'

export const metadata: Metadata = { title: 'Privacy policy' }

const PrivacyPage = (): ReactElement => (
  <LegalFrame testId="privacy-page">
    <PrivacyPolicy testId="privacy" />
  </LegalFrame>
)

export default PrivacyPage
