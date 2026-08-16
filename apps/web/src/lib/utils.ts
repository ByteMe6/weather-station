import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Tailwind-aware class joiner: later classes win on conflict. */
export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
