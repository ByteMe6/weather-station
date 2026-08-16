'use client'

import { ClerkProvider } from '@clerk/nextjs'
import { ThemeProvider } from 'next-themes'
import type { ReactElement, ReactNode } from 'react'

import { MotionProvider } from '@/components/motion/MotionProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { QueryProvider } from '@/lib/query-client'

export const RootProviders = ({
  children,
}: {
  children: ReactNode
}): ReactElement => (
  <ClerkProvider
    appearance={clerkAppearance}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
    signInFallbackRedirectUrl="/dashboard"
    signUpFallbackRedirectUrl="/dashboard"
  >
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      enableColorScheme
    >
      <QueryProvider>
        <MotionProvider>
          <ToastProvider>{children}</ToastProvider>
        </MotionProvider>
      </QueryProvider>
    </ThemeProvider>
  </ClerkProvider>
)
