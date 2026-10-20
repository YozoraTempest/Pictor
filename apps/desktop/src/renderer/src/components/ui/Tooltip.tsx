import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  className?: string
}

/** CSS-only tooltip with an accessible description. */
export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: TooltipProps): React.JSX.Element {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text opacity-0 shadow transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  )
}
