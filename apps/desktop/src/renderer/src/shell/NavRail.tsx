import { openView } from '../app/open-view.js'
import { useUiStore } from '../app/ui-store.js'
import { sortedViews, type AppViewEntry } from '../app/views.js'
import { cn } from '../lib/cn.js'

function RailButton({ view, active }: { view: AppViewEntry; active: boolean }): React.JSX.Element {
  const Icon = view.icon

  return (
    <button
      type="button"
      title={view.label}
      aria-label={view.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        openView(view.id)
      }}
      className={cn(
        'grid size-9 place-items-center rounded-md transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-surface-raised text-text'
          : 'text-faint hover:bg-surface-hover hover:text-muted',
      )}
    >
      <Icon className="size-4.5" />
    </button>
  )
}

/**
 * The global rail.
 *
 * It renders whatever the view registry declares, grouped and ordered by the
 * descriptors themselves: adding a destination never means editing this file.
 */
export function NavRail(): React.JSX.Element {
  const view = useUiStore((state) => state.view)

  const sorted = sortedViews()
  const primary = sorted.filter((entry) => entry.group === 'primary')
  const secondary = sorted.filter((entry) => entry.group === 'secondary')

  return (
    <nav
      aria-label="主导航"
      className="flex w-13 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface/40 py-2"
    >
      {primary.map((entry) => (
        <RailButton key={entry.id} view={entry} active={view === entry.id} />
      ))}

      <div className="mt-auto" />

      {secondary.map((entry) => (
        <RailButton key={entry.id} view={entry} active={view === entry.id} />
      ))}
    </nav>
  )
}
