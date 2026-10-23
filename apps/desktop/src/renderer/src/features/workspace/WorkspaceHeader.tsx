import { PanelLeft, PanelRight, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useUiStore } from '../../app/ui-store.js'
import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Tooltip } from '../../components/ui/index.js'
import { SessionSearchDialog } from '../sessions/SessionSearchDialog.js'
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

/** Right toolbar: conversation search, then the switch for the panels column. */
export function WorkspaceTrailing(): React.JSX.Element {
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const toggleRightPanel = useUiStore((state) => state.toggleRightPanel)
  const [searchOpen, setSearchOpen] = useState(false)

  // The shortcut belongs to the view that owns the button, so it works wherever
  // the reader is inside 首页.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      setSearchOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <Tooltip label="搜索会话" side="bottom" align="end">
        <button
          type="button"
          aria-label="搜索会话"
          aria-keyshortcuts="Control+K Meta+K"
          onClick={() => setSearchOpen(true)}
          className="grid size-7 place-items-center rounded-sm text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
        >
          <Search className="size-3.5" />
        </button>
      </Tooltip>

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

      <SessionSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
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
