import type { ReactNode } from 'react'

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
}: {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
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

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface px-4 py-4">
        {children}
      </div>
    </section>
  )
}
