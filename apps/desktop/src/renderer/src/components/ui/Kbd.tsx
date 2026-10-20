import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export function Kbd({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border bg-surface-raised px-1 font-mono text-2xs text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
