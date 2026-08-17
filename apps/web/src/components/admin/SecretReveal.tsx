'use client'

import type { ReactElement } from 'react'
import { useCallback } from 'react'

import { Button } from '@/components/ui/Button'

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
}): ReactElement => {
  const copyId = useCallback(() => {
    void navigator.clipboard.writeText(deviceId)
  }, [deviceId])
  const copySecret = useCallback(() => {
    void navigator.clipboard.writeText(secret)
  }, [secret])

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <code data-testid={`${testId}-device-id`} className="font-mono text-sm">
          {deviceId}
        </code>
        <Button
          testId={`${testId}-copy-id`}
          variant="ghost"
          size="sm"
          onClick={copyId}
        >
          Copy id
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <code
          data-testid={`${testId}-secret`}
          className="bg-paper-2 rounded-control flex-1 p-2 font-mono text-xs break-all"
        >
          {secret}
        </code>
        <Button
          testId={`${testId}-copy-secret`}
          variant="ghost"
          size="sm"
          onClick={copySecret}
        >
          Copy
        </Button>
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
}
