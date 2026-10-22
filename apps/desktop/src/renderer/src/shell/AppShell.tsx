import { useEffect, type ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { NavRail } from './NavRail.js'
import { TitleBar } from './TitleBar.js'

/**
 * The application frame: rail, title bar, notifications, and the active view.
 *
 * It deliberately knows nothing about columns or panels — each view owns its own
 * layout, so a new destination never has to touch the shell.
 */
export function AppShell({
  children,
  notification,
}: {
  children: ReactNode
  notification?: ReactNode
}): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const recordLocation = useUiStore((state) => state.recordLocation)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  // Every place we land on feeds the title bar's back/forward buttons.
  useEffect(() => {
    recordLocation({ view, sessionId: selectedSessionId })
  }, [view, selectedSessionId, recordLocation])

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />

        <div className="flex min-h-0 flex-1 flex-col">
          {notification !== undefined && <div className="px-3 pt-2">{notification}</div>}
          {children}
        </div>
      </div>
    </div>
  )
}
