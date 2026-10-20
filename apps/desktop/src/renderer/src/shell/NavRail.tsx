import { House, Settings2, type LucideIcon } from 'lucide-react'

import { useUiStore, type AppView } from '../app/ui-store.js'
import { cn } from '../lib/cn.js'
import { withViewTransition } from '../lib/view-transition.js'

const PANELS: Array<{ id: AppView; label: string; icon: LucideIcon }> = [
  { id: 'home', label: '首页', icon: House },
  { id: 'settings', label: '设置', icon: Settings2 },
]

function RailButton({
  panel,
  active,
}: {
  panel: (typeof PANELS)[number]
  active: boolean
}): React.JSX.Element {
  const setView = useUiStore((state) => state.setView)
  const Icon = panel.icon

  return (
    <button
      type="button"
      title={panel.label}
      aria-label={panel.label}
      aria-current={active ? 'page' : undefined}
      onClick={() => {
        withViewTransition(() => setView(panel.id))
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

export function NavRail(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const [home, settings] = PANELS

  return (
    <nav
      aria-label="主导航"
      className="flex w-13 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface/40 py-2"
    >
      {home !== undefined && <RailButton panel={home} active={view === 'home'} />}

      <div className="mt-auto" />

      {settings !== undefined && <RailButton panel={settings} active={view === 'settings'} />}
    </nav>
  )
}
