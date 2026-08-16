import type { ClerkProvider } from '@clerk/nextjs'
import type { ComponentProps } from 'react'

/** Clerk's appearance type, derived from ClerkProvider so it never drifts. */
export type ClerkAppearance = NonNullable<
  ComponentProps<typeof ClerkProvider>['appearance']
>

/** Placeholder until Task 6 maps the design tokens. */
export const clerkAppearance: ClerkAppearance = {}
