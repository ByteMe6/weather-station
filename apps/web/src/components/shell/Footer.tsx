import Link from 'next/link'
import type { ReactElement } from 'react'

export const Footer = ({ testId }: { testId: string }): ReactElement => (
  <footer
    data-testid={testId}
    className="text-slate mx-auto flex max-w-[1180px] items-center justify-between px-6 py-8 text-xs"
  >
    <span>Weather Station</span>
    <Link href="/privacy" className="underline-offset-2 hover:underline">
      Privacy
    </Link>
  </footer>
)
