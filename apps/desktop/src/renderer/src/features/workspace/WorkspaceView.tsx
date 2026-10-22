import { useRef, useState } from 'react'

import {
  RIGHT_DEFAULT,
  RIGHT_MAX,
  RIGHT_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useUiStore,
} from '../../app/ui-store.js'

import { ChatView } from '../chat/ChatView.js'
import { SessionsPanel } from '../sessions/SessionsPanel.js'
import { PanelResizer } from '../../shell/PanelResizer.js'
import { RightPanel } from '../../shell/RightPanel.js'
import { cn } from '../../lib/cn.js'

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

/**
 * The conversation workspace: sessions on the left, chat in the middle, panels on
 * the right.
 *
 * The three-column layout lives here rather than in `AppShell` so a view can own
 * its own grid: the shell only knows how to frame a view, never how wide its
 * columns are or how many it has.
 */
export function WorkspaceView(): React.JSX.Element {
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

  const sidebarVisible = leftPanelOpen || peeking

  return (
    <div className="relative flex min-h-0 flex-1">
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
            <SessionsPanel />
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
            setSidebarWidth(clamp(dragStart.current.sidebar + deltaX, SIDEBAR_MIN, SIDEBAR_MAX))
          }
          onEnd={() => {
            setDragging(null)
            setResizing(false)
          }}
          onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
        />
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
          <ChatView />
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
  )
}
