import { MessageSquare, PanelRight, Settings2, Sparkles } from 'lucide-react'

import { useUiStore, type AppView } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { IconButton } from '../components/ui/index.js'
import { cn } from '../lib/cn.js'
import { withViewTransition } from '../lib/view-transition.js'

const VIEWS: Array<{ id: AppView; label: string; icon: typeof MessageSquare }> = [
  { id: 'chat', label: '对话', icon: MessageSquare },
  { id: 'settings', label: '设置', icon: Settings2 },
]

export function TopBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  const projects = useWorkspaceStore((state) => state.projects)
  const selectedProjectId = useWorkspaceStore((state) => state.selectedProjectId)
  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-surface/50 px-3">
      <div className="flex items-center gap-2">
        <div className="grid size-6 place-items-center rounded-md bg-accent/15 text-accent">
          <Sparkles className="size-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-wide">Pictor</span>
      </div>

      <div className="h-4 w-px bg-border" />

      <p className="min-w-0 truncate text-xs text-muted">
        {project === null ? '未选择项目' : project.name}
      </p>

      <div className="ml-auto flex items-center gap-1.5">
        <div
          role="tablist"
          aria-label="视图"
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
        >
          {VIEWS.map((entry) => {
            const Icon = entry.icon
            const active = view === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  withViewTransition(() => setView(entry.id))
                }}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-sm px-2 text-2xs transition-colors duration-150',
                  active ? 'bg-surface-raised text-text' : 'text-faint hover:text-muted',
                )}
              >
                <Icon className="size-3" />
                {entry.label}
              </button>
            )
          })}
        </div>

        <IconButton
          label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
          onClick={toggleRightPanel}
          className={cn(!rightPanelOpen && 'text-faint')}
        >
          <PanelRight className="size-4" />
        </IconButton>
      </div>
    </header>
  )
}
