import type { Metadata } from 'next'
import type { ReactElement, ReactNode } from 'react'

import { RootProviders } from '@/components/providers/RootProviders'
import { archivo, dmMono } from '@/lib/fonts'

import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Weather Station', template: '%s · Weather Station' },
  description: 'Hyperlocal weather monitoring',
}

const RootLayout = ({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement => (
  <html
    lang="en"
    suppressHydrationWarning
    className={`${archivo.variable} ${dmMono.variable}`}
  >
    <body className="bg-paper text-ink min-h-dvh antialiased">
      <RootProviders>{children}</RootProviders>
    </body>
  </html>
)

export default RootLayout
