import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface PanelProps {
  title?: string
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}

export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
}: PanelProps): React.JSX.Element {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-3',
        className,
      )}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className="flex items-center justify-between gap-2">
          {title !== undefined && (
            <h2 className="text-xs font-semibold tracking-wider text-muted uppercase">{title}</h2>
          )}
          {actions}
        </header>
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col gap-2', bodyClassName)}>{children}</div>
    </section>
  )
}
