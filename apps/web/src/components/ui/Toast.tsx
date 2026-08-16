'use client'

import { AnimatePresence, motion } from 'motion/react'
import type { ReactElement, ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

import { springs } from '@/components/motion/variants'
import { cn } from '@/lib/utils'

export type ToastTone = 'neutral' | 'danger' | 'success'
export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  durationMs?: number
}
interface ToastItem extends ToastInput {
  id: number
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
}
const ToastContext = createContext<ToastContextValue | null>(null)

const TONE: Record<ToastTone, string> = {
  neutral: 'border-line',
  danger: 'border-danger/50',
  success: 'border-sky/50',
}

const ToastRow = ({
  item,
  onDismiss,
}: {
  item: ToastItem
  onDismiss: (id: number) => void
}): ReactElement => {
  const dismiss = useCallback(() => onDismiss(item.id), [item.id, onDismiss])
  return (
    <motion.div
      data-testid={`toast-${item.id}`}
      role="status"
      className={cn(
        'rounded-card bg-card shadow-card pointer-events-auto border p-3',
        TONE[item.tone ?? 'neutral'],
      )}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={springs.default}
      onClick={dismiss}
    >
      <p className="text-sm font-semibold">{item.title}</p>
      {item.description ? (
        <p className="text-slate mt-0.5 text-[13px]">{item.description}</p>
      ) : null}
    </motion.div>
  )
}

export const ToastProvider = ({
  children,
}: {
  children: ReactNode
}): ReactElement => {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId.current
      nextId.current += 1
      setItems((prev) => [...prev, { ...input, id }])
      window.setTimeout(() => dismiss(id), input.durationMs ?? 4000)
    },
    [dismiss],
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
        aria-live="polite"
      >
        <AnimatePresence>
          {items.map((t) => (
            <ToastRow key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
