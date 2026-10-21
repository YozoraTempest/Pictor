import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { SessionsPanel } from '../features/sessions/SessionsPanel.js'
import { cn } from '../lib/cn.js'
import { NavRail } from './NavRail.js'
import { PanelResizer } from './PanelResizer.js'
import { RightPanel } from './RightPanel.js'
import { TitleBar } from './TitleBar.js'

/** Width bounds for the two side columns. */
const SIDEBAR_DEFAULT = 240
const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 360
const RIGHT_DEFAULT = 288
const RIGHT_MIN = 240
const RIGHT_MAX = 420
/** Grace period for crossing from the switch into the sidebar, in milliseconds. */
const PEEK_LINGER = 180

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

export function AppShell({
  children,
  notification,
}: {
  children: ReactNode
  notification?: ReactNode
}): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const leftPanelOpen = useUiStore((state) => state.leftPanelOpen)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)
  const recordLocation = useUiStore((state) => state.recordLocation)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)
  /** Which separator is being dragged; it turns off the width transition. */
  const [dragging, setDragging] = useState<'sidebar' | 'right' | null>(null)
  const dragStart = useRef({ sidebar: SIDEBAR_DEFAULT, right: RIGHT_DEFAULT })

  /**
   * Hover preview for the sidebar. The switch lives in the fixed title bar while
   * the panel sits next to the content, so the two only share this timer.
   */
  const [peeking, setPeeking] = useState(false)
  const hideTimer = useRef<number | null>(null)

  const cancelHide = useCallback((): void => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const showPeek = useCallback((): void => {
    cancelHide()
    if (!leftPanelOpen) setPeeking(true)
  }, [cancelHide, leftPanelOpen])

  const hidePeek = useCallback((): void => {
    cancelHide()
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null
      setPeeking(false)
    }, PEEK_LINGER)
  }, [cancelHide])

  // A pinned panel needs no preview, and the timer must not outlive the view.
  useEffect(() => {
    if (!leftPanelOpen) return
    cancelHide()
    setPeeking(false)
  }, [leftPanelOpen, cancelHide])

  useEffect(() => cancelHide, [cancelHide])

  // Every place we land on feeds the title bar's back/forward buttons.
  useEffect(() => {
    recordLocation({ view, sessionId: selectedSessionId })
  }, [view, selectedSessionId, recordLocation])

  const sidebarVisible = leftPanelOpen || peeking

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar
          sidebarHover={{ onEnter: showPeek, onLeave: hidePeek }}
          sidebarWidth={sidebarWidth}
          sidebarResizing={dragging === 'sidebar'}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          {notification !== undefined && <div className="px-3 pt-2">{notification}</div>}

          {view === 'home' ? (
            <div className="relative flex min-h-0 flex-1">
              {/*
                The sidebar is a drawer. Pinned, it takes layout space and the
                workspace narrows; hovered, it floats over the content so nothing
                else moves — the title bar and its tools stay put either way.
              */}
              <div
                className={cn(
                  'flex flex-col bg-surface/30',
                  leftPanelOpen
                    ? 'relative shrink-0 border-r border-border'
                    : 'absolute inset-y-0 left-0 z-30',
                  !leftPanelOpen && sidebarVisible && 'shadow-panel',
                  dragging === null && 'transition-[width] duration-300 ease-out',
                )}
                style={{ width: sidebarVisible ? sidebarWidth : 0 }}
                onPointerEnter={cancelHide}
                onPointerLeave={hidePeek}
              >
                <aside className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <SessionsPanel />
                </aside>

                {sidebarVisible && (
                  <PanelResizer
                    attach="end"
                    style={{ right: 0 }}
                    label="调整侧栏宽度"
                    onStart={() => {
                      dragStart.current.sidebar = sidebarWidth
                      setDragging('sidebar')
                    }}
                    onMove={(deltaX) =>
                      setSidebarWidth(
                        clamp(dragStart.current.sidebar + deltaX, SIDEBAR_MIN, SIDEBAR_MAX),
                      )
                    }
                    onEnd={() => setDragging(null)}
                    onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
                  />
                )}
              </div>

              <div
                className={cn(
                  'relative grid min-h-0 min-w-0 flex-1',
                  dragging === null && 'transition-[grid-template-columns] duration-300 ease-out',
                )}
                style={{
                  gridTemplateColumns: `minmax(0, 1fr) ${
                    rightPanelOpen ? `${String(rightWidth)}px` : '0px'
                  }`,
                }}
              >
                <main className="view-main min-h-0 min-w-0 overflow-hidden">{children}</main>

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
          ) : (
            <main className="view-main min-h-0 flex-1 overflow-hidden">{children}</main>
          )}
        </div>
      </div>
    </div>
  )
}
