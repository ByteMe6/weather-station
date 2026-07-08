import type { Metadata } from 'next'
import type { ReactElement, ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Weather Station',
  description: 'Hyperlocal weather monitoring',
}

const RootLayout = ({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement => (
  <html lang="en">
    <body>{children}</body>
  </html>
)

export default RootLayout
