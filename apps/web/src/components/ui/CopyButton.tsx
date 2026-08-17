'use client'

import { Check, Copy } from 'lucide-react'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ButtonSize, ButtonVariant } from './Button'
import { Button } from './Button'

type CopyState = 'idle' | 'copied' | 'failed'

const REVERT_MS = 2_000
// `navigator.clipboard.writeText` can hang indefinitely rather than reject —
// notably when the document is not focused — which would leave the button
// silent, the very thing this component exists to prevent.
const SETTLE_MS = 1_200

const withTimeout = async (work: Promise<void>): Promise<void> => {
  let timer: number | undefined
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error('clipboard timeout')),
          SETTLE_MS,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) window.clearTimeout(timer)
  }
}

/**
 * Pre-async-clipboard fallback. Works without clipboard permissions and in
 * unfocused documents, which is where the modern API stalls.
 */
const legacyCopy = (value: string): boolean => {
  const area = document.createElement('textarea')
  area.value = value
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

/**
 * Copy-to-clipboard with visible confirmation. Without it there is no way to
 * tell a successful copy from a dead click — which matters most where the value
 * is shown once and cannot be re-read (device secrets).
 *
 * `navigator.clipboard` is undefined outside a secure context (plain http on a
 * LAN address, for instance), so failure is surfaced rather than swallowed:
 * the caller's value stays selectable for a manual copy.
 */
export const CopyButton = ({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'ghost',
  size = 'sm',
  testId,
}: {
  value: string
  label?: string
  copiedLabel?: string
  variant?: ButtonVariant
  size?: ButtonSize
  testId: string
}): ReactElement => {
  const [state, setState] = useState<CopyState>('idle')
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    try {
      await withTimeout(navigator.clipboard.writeText(value))
      setState('copied')
    } catch {
      setState(legacyCopy(value) ? 'copied' : 'failed')
    }
    timer.current = window.setTimeout(() => setState('idle'), REVERT_MS)
  }, [value])

  return (
    <Button
      testId={testId}
      variant={state === 'copied' ? 'primary' : variant}
      size={size}
      onClick={copy}
      aria-live="polite"
    >
      {state === 'copied' ? (
        <Check className="size-3.5" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
      {state === 'copied'
        ? copiedLabel
        : state === 'failed'
          ? 'Press ⌘C'
          : label}
    </Button>
  )
}
