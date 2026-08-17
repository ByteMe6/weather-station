import type { ReactElement } from 'react'

import { CopyButton } from '@/components/ui/CopyButton'

/**
 * The only place a device secret is ever rendered. It arrives from a server
 * action, lives in component state, and is never re-fetchable — losing it means
 * rotating, which is deliberate: a fleet-wide "reveal secret" affordance would
 * make every admin session a standing key-exfiltration path.
 */
export const SecretReveal = ({
  deviceId,
  secret,
  testId,
}: {
  deviceId: string
  secret: string
  testId: string
}): ReactElement => (
  <div data-testid={testId} className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <code
        data-testid={`${testId}-device-id`}
        className="font-mono text-sm select-all"
      >
        {deviceId}
      </code>
      <CopyButton
        testId={`${testId}-copy-id`}
        value={deviceId}
        label="Copy id"
        copiedLabel="Id copied"
      />
    </div>
    <div className="flex items-start gap-2">
      <code
        data-testid={`${testId}-secret`}
        className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all select-all"
      >
        {secret}
      </code>
      <CopyButton
        testId={`${testId}-copy-secret`}
        value={secret}
        label="Copy secret"
        copiedLabel="Secret copied"
      />
    </div>
    <p
      data-testid={`${testId}-warning`}
      className="text-danger text-[13px] font-medium"
    >
      Shown once. Flash it now — nobody can read it again; it can only be
      rotated.
    </p>
  </div>
)
