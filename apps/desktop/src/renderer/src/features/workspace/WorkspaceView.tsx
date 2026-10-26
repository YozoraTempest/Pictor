import { useEffect, useRef, useState } from 'react'

import {
  RIGHT_DEFAULT,
  RIGHT_MAX,
  RIGHT_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useUiStore,
} from '../../app/ui-store.js'

import { useWorkspaceStore } from '../../app/workspace-store.js'
import { Banner } from '../../components/ui/index.js'
import { ChatView } from '../chat/ChatView.js'
import { SessionsPanel } from '../sessions/SessionsPanel.js'
import { PanelResizer } from '../../shell/PanelResizer.js'
import { RightPanel } from '../../shell/RightPanel.js'
import { cn } from '../../lib/cn.js'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export interface WorkspaceViewProps {
  /**
   * The kernel this page is about.
   *
   * A kernel page lists that kernel's conversations and starts new ones on it. The
   * home page has no kernel and, for now, no list either: it is where a task begins,
   * and where it lives afterwards is the page of whatever kernel ran it. Merging every
   * kernel's conversations into one column is the thing this avoids — the same list
   * would have to describe two very different runtimes.
   */
  kernelId?: string | null
}

/**
 * The conversation workspace: sessions on the left, chat in the middle, panels on
 * the right.
 *
 * The three-column layout lives here rather than in `AppShell` so a view can own
 * its own grid: the shell only knows how to frame a view, never how wide its
 * columns are or how many it has.
 */
export function WorkspaceView({ kernelId = null }: WorkspaceViewProps): React.JSX.Element {
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const sidebarWidth = useUiStore((state) => state.sidebarWidth)
  const rightWidth = useUiStore((state) => state.rightWidth)
  const peeking = useUiStore((state) => state.sidebarPeeking)
  const peekSidebar = useUiStore((state) => state.peekSidebar)
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth)
  const setRightWidth = useUiStore((state) => state.setRightWidth)
  const setResizing = useUiStore((state) => state.setSidebarResizing)

  /** Widths at the moment a drag starts, so the delta applies to the right base. */
  const dragStart = useRef({ sidebar: sidebarWidth, right: rightWidth })
  const [dragging, setDragging] = useState<'sidebar' | 'right' | null>(null)

  const kernels = useWorkspaceStore((state) => state.kernels)
  const kernel = kernelId === null ? null : (kernels.find((entry) => entry.id === kernelId) ?? null)
  const unavailable = kernel !== null && !kernel.available

  const sessions = useWorkspaceStore((state) => state.sessions)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)
  const selectSession = useWorkspaceStore((state) => state.selectSession)
  const draft = useWorkspaceStore((state) => state.draft)
  const startDraft = useWorkspaceStore((state) => state.startDraft)

  /**
   * Home opens on a draft: the composer is the only control this page has, and an
   * empty state pointing at a conversation list would point at nothing.
   */
  useEffect(() => {
    if (kernelId !== null) return
    if (selectedSessionId !== null || draft !== null) return
    startDraft({ sectionId: null })
  }, [kernelId, selectedSessionId, draft, startDraft])

  /**
   * A kernel page opens a conversation of its own kernel.
   *
   * Selection survives a view switch, so walking onto the Pi page from a dsh
   * conversation would leave that transcript — and its sandbox and model controls —
   * under a page that says Pi. Opening the newest conversation of the page's own
   * kernel is what keeps the page true. Nothing is opened while a draft is being
   * written: that conversation has no kernel yet.
   */
  useEffect(() => {
    if (kernelId === null || selectedSessionId === null) return
    const selected = sessions.find((session) => session.id === selectedSessionId)
    // Not in the list yet: a fork or a new conversation is selected before the refresh
    // lands, and picking "the newest of this kernel" now would undo that choice.
    if (selected === undefined) return
    if (selected.kernelId === kernelId) return
    const next = sessions
      .filter((session) => session.kernelId === kernelId && !session.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    selectSession(next?.id ?? null)
  }, [kernelId, selectedSessionId, sessions, selectSession])

  /**
   * The list belongs to a kernel, not to the app.
   *
   * Home starts conversations and shows the open one; it does not pretend to hold a
   * list of everything, because that list would be a merge of several runtimes.
   */
  const showSessions = kernelId !== null
  const sidebarVisible = showSessions && (leftPanelOpen || peeking)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {unavailable && (
        <div className="shrink-0 px-3 pt-2">
          <Banner tone="error">
            {kernel?.label ?? kernelId}{' '}
            在这台机器上还跑不起来：没有找到它的可执行文件。装好之后重新打开这一页。
          </Banner>
        </div>
      )}
      <div className="relative flex min-h-0 flex-1">
        {/* A kernel page owns a session list; home has none, so it draws no drawer. */}
        {showSessions && (
          <>
            {/*
              The sidebar is a drawer. Pinned, it takes layout space and the workspace
              narrows; hovered, it floats over the content so nothing else moves — the
              title bar and its tools stay put either way.
            */}
            <div
              className={cn(
                'flex flex-col overflow-hidden bg-bg',
                leftPanelOpen
                  ? 'relative shrink-0 border-r border-border'
                  : 'absolute inset-y-0 left-0 z-30',
                !leftPanelOpen && sidebarVisible && 'shadow-panel',
                dragging === null && 'transition-[width] duration-300 ease-out',
              )}
              style={{ width: sidebarVisible ? sidebarWidth : 0 }}
              onPointerEnter={() => peekSidebar(true)}
              onPointerLeave={() => peekSidebar(false)}
            >
              {/* The content keeps its width while the drawer narrows, so a collapsing
                panel clips its labels instead of wrapping them. */}
              <div className="flex min-h-0 flex-1 flex-col" style={{ width: sidebarWidth }}>
                <aside className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface/30">
                  <SessionsPanel kernelId={kernelId} />
                </aside>
              </div>
            </div>

            {/* Outside the drawer so clipping never eats the handle. */}
            {sidebarVisible && (
              <PanelResizer
                attach="end"
                style={{ left: sidebarWidth }}
                label="调整侧栏宽度"
                onStart={() => {
                  dragStart.current.sidebar = sidebarWidth
                  setDragging('sidebar')
                  setResizing(true)
                }}
                onMove={(deltaX) =>
                  setSidebarWidth(
                    clamp(dragStart.current.sidebar + deltaX, SIDEBAR_MIN, SIDEBAR_MAX),
                  )
                }
                onEnd={() => {
                  setDragging(null)
                  setResizing(false)
                }}
                onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
              />
            )}
          </>
        )}

        <div
          className={cn(
            'relative grid min-h-0 min-w-0 flex-1',
            dragging === null && 'transition-[grid-template-columns] duration-300 ease-out',
          )}
          style={{
            gridTemplateColumns: `minmax(0, 1fr) ${rightPanelOpen ? `${String(rightWidth)}px` : '0px'}`,
          }}
        >
          <main className="view-main min-h-0 min-w-0 overflow-hidden">
            <ChatView kernelId={kernelId} />
          </main>

          <RightPanel />

          {rightPanelOpen && (
            <PanelResizer
              attach="start"
              style={{ right: rightWidth }}
              label="调整右侧面板宽度"
              onStart={() => {
                dragStart.current.right = rightWidth
                setDragging('right')
              }}
              onMove={(deltaX) =>
                // Dragging left widens the right panel.
                setRightWidth(clamp(dragStart.current.right - deltaX, RIGHT_MIN, RIGHT_MAX))
              }
              onEnd={() => setDragging(null)}
              onReset={() => setRightWidth(RIGHT_DEFAULT)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
