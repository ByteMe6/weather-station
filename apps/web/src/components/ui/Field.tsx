import type { ReactElement, ReactNode } from 'react'

interface FieldProps {
  testId: string
  label: string
  htmlFor: string
  error?: string
  hint?: string
  children: ReactNode
}

export const Field = ({
  testId,
  label,
  htmlFor,
  error,
  hint,
  children,
}: FieldProps): ReactElement => (
  <div data-testid={testId} className="flex flex-col gap-1.5">
    <label htmlFor={htmlFor} className="text-slate text-[13px] font-medium">
      {label}
    </label>
    {children}
    {error ? (
      <p
        data-testid={`${testId}-error`}
        role="alert"
        className="text-danger text-[13px]"
      >
        {error}
      </p>
    ) : hint ? (
      <p data-testid={`${testId}-hint`} className="text-slate text-[13px]">
        {hint}
      </p>
    ) : null}
  </div>
)
