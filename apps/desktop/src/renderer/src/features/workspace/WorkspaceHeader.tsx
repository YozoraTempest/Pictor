import { PanelLeft, PanelRight } from 'lucide-react'

import { useUiStore } from '../../app/ui-store.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Tooltip } from '../../components/ui/index.js'
import { cn } from '../../lib/cn.js'

/** Left toolbar: the switch for the sessions column. */
export function WorkspaceLeading(): React.JSX.Element {
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)
  const peekSidebar = useUiStore((state) => state.peekSidebar)

  return (
    <Tooltip
      label={leftPanelOpen ? '收起侧栏' : '悬停预览，点击展开侧栏'}
      side="bottom"
      align="start"
    >
      <button
        type="button"
        aria-label={leftPanelOpen ? '收起侧栏' : '展开侧栏'}
        onClick={toggleLeftPanel}
        onPointerEnter={() => peekSidebar(true)}
        onPointerLeave={() => peekSidebar(false)}
        className={cn(
          'grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
          leftPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
        )}
      >
        <PanelLeft className="size-3.5" />
      </button>
    </Tooltip>
  )
}

/** Right toolbar: the switch for the panels column. */
export function WorkspaceTrailing(): React.JSX.Element {
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)

  return (
    <Tooltip label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'} side="bottom" align="end">
      <button
        type="button"
        aria-label={rightPanelOpen ? '收起右侧面板' : '展开右侧面板'}
        onClick={toggleRightPanel}
        className={cn(
          'grid size-7 place-items-center rounded-sm transition-colors duration-150 hover:bg-surface-hover',
          rightPanelOpen ? 'text-muted hover:text-text' : 'text-faint',
        )}
      >
        <PanelRight className="size-3.5" />
      </button>
    </Tooltip>
  )
}

/**
 * The centred title: the project the agent is working in, then the conversation.
 *
 * A session outside every project reports 临时任务, and the conversation is only
 * named once one is open.
 */
export function WorkspaceTitle(): React.JSX.Element {
  const projects = useWorkspaceStore((state) => state.projects)
  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  const session = sessions.find((entry) => entry.id === selectedSessionId) ?? null
  const project = projects.find((entry) => entry.id === session?.projectId) ?? null

  return (
    <>
      {project?.name ?? '临时任务'}
      {session !== null && <span className="text-muted"> / {session.title}</span>}
    </>
  )
}
