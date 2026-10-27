import type { ReactNode } from 'react'

import { cn } from '@vulonlok/ui/cn'

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
  bare = false,
}: {
  /**
   * Omit it where the surrounding view already names this block — a tab, say.
   *
   * The header then carries only what the block has to say and what can be done to
   * it, which is the difference between a section under a heading and a section that
   * *is* the heading.
   */
  title?: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  /** Pinned under the body, for a form that is saved by hand. */
  footer?: ReactNode
  /** `false` lets `SettingRow` children own the padding and draw dividers. */
  padded?: boolean
  /**
   * Draw no card around the body.
   *
   * For a section whose children are cards already: a border around borders is the same
   * boundary drawn twice, and it makes the inner cards look like they are inside
   * something rather than being the list.
   */
  bare?: boolean
}): React.JSX.Element {
  return (
    <section className="flex min-h-0 flex-col gap-2.5">
      {(title !== undefined || description !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-0.5">
          <div className="min-w-0 flex-1 basis-56">
            {title !== undefined && <h2 className="text-sm font-medium text-text">{title}</h2>}
            {description !== undefined && (
              <p
                className={cn(
                  'text-xs leading-relaxed text-faint',
                  title !== undefined && 'mt-0.5',
                )}
              >
                {description}
              </p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}

      {bare ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
          <div
            className={cn('flex flex-col', padded ? 'gap-4 px-4 py-4' : 'divide-y divide-border')}
          >
            {children}
          </div>

          {footer !== undefined && <div className="border-t border-border">{footer}</div>}
        </div>
      )}
    </section>
  )
}
