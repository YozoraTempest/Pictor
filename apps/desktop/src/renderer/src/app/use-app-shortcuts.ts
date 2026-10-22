import { useEffect } from 'react'

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
          void createSession(newSessionTitle(), null)
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
        default:
          return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createSession, setView, toggleLeftPanel])
}
