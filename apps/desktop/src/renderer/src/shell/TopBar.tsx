import { PanelRight, Sparkles } from 'lucide-react'

import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { IconButton } from '../components/ui/index.js'
import { cn } from '../lib/cn.js'

export function TopBar(): React.JSX.Element {
  const view = useUiStore((state) => state.view)
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
        {view === 'settings' ? '设置' : (project?.name ?? '未选择项目')}
      </p>

      {view === 'home' && (
        <div className="ml-auto flex items-center gap-1.5">
          <IconButton
            label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
            onClick={toggleRightPanel}
            className={cn(!rightPanelOpen && 'text-faint')}
          >
            <PanelRight className="size-4" />
          </IconButton>
        </div>
      )}
    </header>
  )
}
