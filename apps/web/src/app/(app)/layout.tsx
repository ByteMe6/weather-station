import { auth } from '@clerk/nextjs/server'
import type { ReactElement, ReactNode } from 'react'

import { AppShell } from '@/components/shell/AppShell'
import { EnsureUser } from '@/components/shell/EnsureUser'

/**
 * Every route in the (app) group requires a session. The proxy already
 * redirects signed-out visitors; this resource-level check is Clerk v7's
 * recommended defence in depth (path matching can diverge from routing).
 */
const AppLayout = async ({
  children,
}: {
  children: ReactNode
}): Promise<ReactElement> => {
  await auth.protect()
  return (
    <EnsureUser>
      <AppShell testId="app-shell">{children}</AppShell>
    </EnsureUser>
  )
}

export default AppLayout
