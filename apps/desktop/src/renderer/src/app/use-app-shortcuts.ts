import { useEffect } from 'react'

import { kernelOfView, kernelViewId } from './kernel-scope.js'
import { railViews } from './views.js'
import { openView } from './open-view.js'
import { useUiStore } from './ui-store.js'
import { useWorkspaceStore } from './workspace-store.js'

function newSessionTitle(): string {
  const now = new Date()
  return `新会话 ${now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Accelerators for the shortcuts the app menu advertises.
 *
 * Editing and clipboard chords are deliberately absent: Chromium already handles
 * them inside editable fields, and intercepting them would break text editing.
 */
export function useAppShortcuts(): void {
  const createSession = useWorkspaceStore((state) => state.createSession)
  const setView = useUiStore((state) => state.setView)
  const toggleLeftPanel = useUiStore((state) => state.toggleLeftPanel)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey
      if (!modifier || event.altKey || event.shiftKey) return

      switch (event.key.toLowerCase()) {
        case 'n':
          event.preventDefault()
          // The open page decides the kernel, the same way its own 新聊天 does. Home
          // names none, and the server picks the default — then the page follows the
          // session, because home is empty and a session with nowhere to type is a bug.
          void createSession(
            newSessionTitle(),
            null,
            kernelOfView(useUiStore.getState().view),
          ).then((session) => {
            if (session !== null) openView(kernelViewId(session.kernelId))
          })
          return
        case ',':
          event.preventDefault()
          openView('settings')
          return
        case 'b':
          event.preventDefault()
          toggleLeftPanel()
          return
        case 'w':
          event.preventDefault()
          void window.pictor.windowCommand('close')
          return
        case '=':
        case '+':
          event.preventDefault()
          void window.pictor.windowCommand('zoomIn')
          return
        case '-':
          event.preventDefault()
          void window.pictor.windowCommand('zoomOut')
          return
        case '0':
          event.preventDefault()
          void window.pictor.windowCommand('zoomReset')
          return
        default: {
          // A destination names its own accelerator — home is Ctrl+1, the mounted ars take
          // Ctrl+2 onward in the rail's order — so the numbers follow what is installed
          // and a third ars needs no new binding. Pages without a seat in the rail name
          // none, and this does not invent one for them.
          const target = railViews(useWorkspaceStore.getState().kernels).find(
            (entry) => entry.shortcut === `Ctrl+${event.key}`,
          )
          if (target === undefined) return
          event.preventDefault()
          openView(target.id)
          return
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createSession, setView, toggleLeftPanel])
}
