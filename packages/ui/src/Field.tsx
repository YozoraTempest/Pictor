import type { ReactNode } from 'react'

import { cn } from './cn.js'

export interface FieldProps {
  label: string
  hint?: string
  error?: string
  htmlFor?: string
  className?: string
  children: ReactNode
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps): React.JSX.Element {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)} htmlFor={htmlFor}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error !== undefined ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint !== undefined ? (
        <span className="text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  )
}
