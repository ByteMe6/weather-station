import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'

import { Logo } from '@/components/brand/Logo'

/** Shell-less frame for legal pages: brand, a way back, and a prose column. */
export const LegalFrame = ({
  children,
  testId,
}: {
  children: ReactNode
  testId: string
}): ReactElement => (
  <main
    data-testid={testId}
    className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-10"
  >
    <div className="mb-10 flex items-center justify-between">
      <Link
        href="/"
        className="flex items-center gap-2 font-semibold tracking-tight"
      >
        <Logo testId={`${testId}-logo`} size={20} />
        Weather Station
      </Link>
      <Link
        href="/dashboard"
        className="text-slate text-sm underline-offset-2 hover:underline"
      >
        Back to the app
      </Link>
    </div>
    {children}
  </main>
)
