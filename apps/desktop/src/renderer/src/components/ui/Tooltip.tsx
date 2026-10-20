import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface TooltipProps {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  /** Which edge of the anchor the bubble is aligned to. Use `end` near the right edge. */
  align?: 'center' | 'start' | 'end'
  className?: string
}

/**
 * CSS-only tooltip with an accessible description.
 *
 * It sticks to CSS rather than a portal so the bubble stays cheap; `align`
 * exists because a centred bubble is clipped for controls that sit on a panel
 * or window edge.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  align = 'center',
  className,
}: TooltipProps): React.JSX.Element {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text opacity-0 shadow transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'start' && 'left-0',
          align === 'end' && 'right-0',
        )}
      >
        {label}
      </span>
    </span>
  )
}
