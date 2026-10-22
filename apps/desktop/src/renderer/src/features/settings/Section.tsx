import type { ReactNode } from 'react'

import { cn } from '../../lib/cn.js'

/**
 * A settings section: the heading sits on the page, the content sits in a card.
 *
 * Keeping the title outside the surface is what lets a page read as a stack of
 * labelled blocks instead of a stack of cards that each repeat their own header,
 * and it matches how the rest of the app groups content.
 */
export function Section({
  title,
  description,
  children,
  actions,
  footer,
  padded = true,
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  /** Pinned under the body, for a form that is saved by hand. */
  footer?: ReactNode
  /** `false` lets `SettingRow` children own the padding and draw dividers. */
  padded?: boolean
}): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-col gap-2.5">
      <header className="flex items-start justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text">{title}</h2>
          {description !== undefined && <p className="mt-0.5 text-xs text-faint">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
        <div className={cn('flex flex-col', padded ? 'gap-4 px-4 py-4' : 'divide-y divide-border')}>
          {children}
        </div>

        {footer !== undefined && <div className="border-t border-border">{footer}</div>}
      </div>
    </section>
  )
}
