import type { ClerkProvider } from '@clerk/nextjs'
import type { ComponentProps } from 'react'

/** Clerk's appearance type, derived from ClerkProvider so it never drifts. */
export type ClerkAppearance = NonNullable<
  ComponentProps<typeof ClerkProvider>['appearance']
>

/** Maps Clerk components onto the design tokens (spec §1.1). Core 3 variable names. */
export const clerkAppearance: ClerkAppearance = {
  variables: {
    colorPrimary: '#1e6fe8',
    colorDanger: '#d3323a',
    colorBackground: 'var(--color-card)',
    colorForeground: 'var(--color-ink)',
    colorMutedForeground: 'var(--color-slate)',
    colorInput: 'var(--color-card)',
    colorInputForeground: 'var(--color-ink)',
    colorBorder: 'var(--color-line)',
    borderRadius: '9px',
    fontFamily: 'var(--font-sans)',
  },
  options: {
    privacyPageUrl: '/privacy',
  },
  elements: {
    card: 'shadow-card border border-line',
    formButtonPrimary: 'bg-ink hover:opacity-90 text-paper',
    footerActionLink: 'text-sky',
  },
}
