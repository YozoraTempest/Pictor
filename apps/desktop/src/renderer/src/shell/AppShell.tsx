import { useEffect, type ReactNode } from 'react'

import { useUiStore } from '../app/ui-store.js'
import { useWorkspaceStore } from '../app/workspace-store.js'
import { SlotOutlet } from '../features/slots/SlotOutlet.js'
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
  const slots = useWorkspaceStore((state) => state.slots)

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

      {/* `shell.overlay`: above every column and outside their scroll boxes.
          The layer itself is click-through, so a seat never blocks the app underneath —
          an occupant that wants clicks puts them on its own element. */}
      {/* Anchored top-left under the title bar, growing down. Every corner that carries a
          control is taken: bottom-right is the composer, top-right the panel column, and
          the bottom edge is `shell.bottom`. What is left is where a conversation begins —
          and the layer is click-through anyway, so overlap costs no interaction. */}
      <div
        aria-label="浮动层"
        className="pointer-events-none fixed top-11 left-16 z-40 flex max-h-[55vh] flex-col items-start gap-2"
      >
        <SlotOutlet
          slot="shell.overlay"
          seats={slots}
          sessionId={selectedSessionId}
          className="pointer-events-none w-80"
        />
      </div>
    </div>
  )
}
