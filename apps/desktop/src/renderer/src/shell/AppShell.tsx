import type { ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
import { ProjectsPanel } from '../features/projects/ProjectsPanel.js'
import { SessionsPanel } from '../features/sessions/SessionsPanel.js'
import { RightPanel } from './RightPanel.js'
import { TopBar } from './TopBar.js'

export function AppShell({
  children,
  notification,
}: {
  children: ReactNode
  notification?: ReactNode
}): React.JSX.Element {
  const rightPanelOpen = useUiStore((state) => state.rightPanelOpen)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg text-text">
      <TopBar />

      {notification !== undefined && <div className="px-3 pt-2">{notification}</div>}

      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out"
        style={{
          gridTemplateColumns: rightPanelOpen
            ? 'clamp(220px, 20vw, 260px) minmax(0, 1fr) clamp(240px, 26vw, 320px)'
            : 'clamp(220px, 20vw, 260px) minmax(0, 1fr) 0px',
        }}
      >
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-border bg-surface/30">
          <ProjectsPanel />
          <SessionsPanel />
        </aside>

        <main className="view-main min-h-0 min-w-0 overflow-hidden">{children}</main>

        <RightPanel />
      </div>
    </div>
  )
}
