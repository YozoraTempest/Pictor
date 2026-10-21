import { useRef, useState, type ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
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

  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)
  /** Which separator is being dragged; it turns off the column transition. */
  const [dragging, setDragging] = useState<'sidebar' | 'right' | null>(null)
  const dragStart = useRef({ sidebar: SIDEBAR_DEFAULT, right: RIGHT_DEFAULT })

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <NavRail />

      {/*
        The sidebar runs the full window height, so its divider reaches the top
        edge instead of stopping at the title bar. The title bar itself only
        spans the workspace column, which removes the line between the two.
      */}
      {view === 'home' && (
        <div
          className={cn(
            'relative flex shrink-0',
            dragging === null && 'transition-[width] duration-300 ease-out',
          )}
          style={{ width: leftPanelOpen ? sidebarWidth : 0 }}
        >
          <aside
            className={cn(
              'flex min-h-0 w-full flex-col overflow-hidden bg-surface/30',
              leftPanelOpen && 'border-r border-border',
            )}
          >
            <SessionsPanel />
          </aside>

          {leftPanelOpen && (
            <PanelResizer
              attach="end"
              style={{ right: 0 }}
              label="调整侧栏宽度"
              onStart={() => {
                dragStart.current.sidebar = sidebarWidth
                setDragging('sidebar')
              }}
              onMove={(deltaX) =>
                setSidebarWidth(clamp(dragStart.current.sidebar + deltaX, SIDEBAR_MIN, SIDEBAR_MAX))
              }
              onEnd={() => setDragging(null)}
              onReset={() => setSidebarWidth(SIDEBAR_DEFAULT)}
            />
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />

        <div className="flex min-h-0 flex-1 flex-col">
          {notification !== undefined && <div className="px-3 pt-2">{notification}</div>}

          {view === 'home' ? (
            <div
              className={cn(
                'relative grid min-h-0 flex-1',
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
          ) : (
            <main className="view-main min-h-0 flex-1 overflow-hidden">{children}</main>
          )}
        </div>
      </div>
    </div>
  )
}
