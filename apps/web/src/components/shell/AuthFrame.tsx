import Link from 'next/link'
import type { ReactElement, ReactNode } from 'react'

/** Shell-less frame for sign-in/up and legal pages: brand + content + privacy link. */
export const AuthFrame = ({
  children,
  testId,
}: {
  children: ReactNode
  testId: string
}): ReactElement => (
  <main
    data-testid={testId}
    className="flex min-h-dvh flex-col items-center px-4 py-10"
  >
    <Link
      href="/"
      className="mb-8 flex items-center gap-2 font-semibold tracking-tight"
    >
      <span
        aria-hidden
        className="from-sky to-sky/60 inline-block size-5 rounded-md bg-gradient-to-br"
      />
      Weather Station
    </Link>
    {children}
    <p className="text-slate mt-8 text-[13px]">
      By continuing you agree to the{' '}
      <Link href="/privacy" className="underline underline-offset-2">
        privacy policy
      </Link>
      .
    </p>
  </main>
)
