import { openView } from '../app/open-view.js'
import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { railViews, type AppViewDescriptor } from '../app/views.js'
import { cn } from '../lib/cn.js'
import { Tooltip } from '../components/ui/index.js'

function RailButton({
  view,
  active,
}: {
  view: AppViewDescriptor
  active: boolean
}): React.JSX.Element {
  const Icon = view.icon

  return (
    <Tooltip label={view.label} side="right">
      <button
        type="button"
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
    </Tooltip>
  )
}

/**
 * The global rail.
 *
 * It renders whatever the view registry derives, grouped and ordered by the
 * descriptors themselves: a kernel that gets installed appears here without an edit.
 */
export function NavRail(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const kernels = useWorkspaceStore((state) => state.kernels)

  const sorted = railViews(kernels)
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
