import type { ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
import { SessionsPanel } from '../features/sessions/SessionsPanel.js'
import { NavRail } from './NavRail.js'
import { RightPanel } from './RightPanel.js'
import { TitleBar } from './TitleBar.js'

const SIDEBAR_WIDTH = 'clamp(220px, 20vw, 260px)'

export function AppShell({
  children,
  notification,
}: {
  children: ReactNode
  notification?: ReactNode
}): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <NavRail />

        <div className="flex min-w-0 flex-1 flex-col">
          {notification !== undefined && <div className="px-3 pt-2">{notification}</div>}

          {view === 'home' ? (
            <div
              className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out"
              style={{
                gridTemplateColumns: rightPanelOpen
                  ? `${SIDEBAR_WIDTH} minmax(0, 1fr) clamp(240px, 26vw, 320px)`
                  : `${SIDEBAR_WIDTH} minmax(0, 1fr) 0px`,
              }}
            >
              <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-surface/30">
                <SessionsPanel />
              </aside>

              <main className="view-main min-h-0 min-w-0 overflow-hidden">{children}</main>

              <RightPanel />
            </div>
          ) : (
            <main className="view-main min-h-0 flex-1 overflow-hidden">{children}</main>
          )}
        </div>
      </div>
    </div>
  )
}
