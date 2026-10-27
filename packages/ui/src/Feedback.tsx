import type { ReactNode } from 'react'

import { cn } from './cn.js'

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'success'

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}): React.JSX.Element {
  const tones: Record<BadgeTone, string> = {
    neutral: 'border-border text-muted',
    accent: 'border-accent/40 text-accent',
    danger: 'border-danger/40 text-danger',
    success: 'border-success/40 text-success',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent',
        className,
      )}
    />
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-sm text-text">{title}</p>
      {description !== undefined && <p className="max-w-sm text-xs text-faint">{description}</p>}
      {action}
    </div>
  )
}
