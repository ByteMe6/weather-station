/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/Input'
import { Skeleton } from '@/components/ui/Skeleton'

describe('ui primitives', () => {
  it('Button renders variants, sizes, loading state and forwards testId', () => {
    render(
      <Button testId="btn" variant="danger" size="sm" loading>
        Delete
      </Button>,
    )
    const btn = screen.getByTestId('btn')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.className).toContain('bg-danger')
  })

  it('Card renders an accent bar when accent is given', () => {
    render(
      <Card testId="card" accent="temp">
        x
      </Card>,
    )
    expect(screen.getByTestId('card').getAttribute('data-accent')).toBe('temp')
  })

  it('Skeleton is aria-hidden', () => {
    render(<Skeleton testId="sk" className="h-4 w-10" />)
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true')
  })

  it('Badge live tone shows the live dot', () => {
    render(
      <Badge testId="b" tone="live">
        Live
      </Badge>,
    )
    expect(screen.getByTestId('b-dot')).toBeInTheDocument()
  })

  it('EmptyState renders title, description and action', () => {
    render(
      <EmptyState
        testId="es"
        title="No station yet"
        description="Register one."
        action={<Button testId="a">Go</Button>}
      />,
    )
    expect(screen.getByTestId('es')).toHaveTextContent('No station yet')
    expect(screen.getByTestId('a')).toBeInTheDocument()
  })

  it('Field wires label, error and aria-invalid on the input', () => {
    render(
      <Field testId="f" label="Device ID" htmlFor="dev" error="Unknown ID">
        <Input testId="in" id="dev" invalid />
      </Field>,
    )
    expect(screen.getByLabelText('Device ID')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByTestId('f-error')).toHaveTextContent('Unknown ID')
  })
})
