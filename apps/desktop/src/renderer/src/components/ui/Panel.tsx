import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

export interface PanelProps {
  title?: string
  description?: string
  actions?: ReactNode
  className?: string
  headerClassName?: string
  titleClassName?: string
  bodyClassName?: string
  children: ReactNode
}

/**
 * The card primitive: one bordered surface with an optional header.
 *
 * It stays dumb on purpose — padding and typography are overridable so feature
 * areas can keep their own density without forking the component.
 */
export function Panel({
  title,
  description,
  actions,
  className,
  headerClassName,
  titleClassName,
  bodyClassName,
  children,
}: PanelProps): React.JSX.Element {
  const hasHeader = title !== undefined || description !== undefined || actions !== undefined

  return (
    <section
      className={cn('flex min-h-0 flex-col rounded-lg border border-border bg-surface', className)}
    >
      {hasHeader && (
        <header
          className={cn('flex items-start justify-between gap-3 px-3 py-2.5', headerClassName)}
        >
          <div className="min-w-0">
            {title !== undefined && (
              <h2
                className={cn(
                  'text-xs font-semibold tracking-wider text-muted uppercase',
                  titleClassName,
                )}
              >
                {title}
              </h2>
            )}
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-faint">{description}</p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col gap-3 p-3', bodyClassName)}>{children}</div>
    </section>
  )
}
