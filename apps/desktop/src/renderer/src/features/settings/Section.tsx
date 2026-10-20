import type { ReactNode } from 'react'

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
    <section className="rounded-lg border border-border bg-surface/40">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {description !== undefined && <p className="mt-0.5 text-xs text-faint">{description}</p>}
        </div>
        {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
    </section>
  )
}
