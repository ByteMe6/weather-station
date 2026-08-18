'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import type { ReactElement } from 'react'
import { useCallback } from 'react'

const ORDER = ['system', 'light', 'dark'] as const
type Theme = (typeof ORDER)[number]
const ICON: Record<Theme, ReactElement> = {
  system: <Monitor className="size-4" aria-hidden />,
  light: <Sun className="size-4" aria-hidden />,
  dark: <Moon className="size-4" aria-hidden />,
}

const isTheme = (v: string | undefined): v is Theme =>
  v !== undefined && (ORDER as readonly string[]).includes(v)

export const ThemeToggle = ({ testId }: { testId: string }): ReactElement => {
  const { theme, setTheme } = useTheme()
  const current: Theme = isTheme(theme) ? theme : 'system'
  const cycle = useCallback(() => {
    const next: Theme =
      ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system'
    setTheme(next)
  }, [current, setTheme])
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={cycle}
      aria-label={`Theme: ${current}. Click to change`}
      // inline-flex, not the button's default text-align: center — Preflight
      // makes the icon `display: block`, which text-align cannot move. Harmless
      // until the 44px touch target gave the box slack the icon then ignored.
      className="rounded-control border-line text-slate hover:text-ink inline-flex shrink-0 items-center justify-center border p-2 max-lg:size-11"
    >
      {ICON[current]}
    </button>
  )
}
