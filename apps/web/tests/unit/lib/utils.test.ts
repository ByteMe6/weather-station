import { cn } from '@/lib/utils'

describe('cn', () => {
  it('merges conditional classes and resolves tailwind conflicts', () => {
    expect(cn('p-2', false && 'hidden', 'p-4')).toBe('p-4')
    expect(
      cn('text-ink', undefined, ['rounded-card', { 'opacity-50': true }]),
    ).toBe('text-ink rounded-card opacity-50')
  })
})
