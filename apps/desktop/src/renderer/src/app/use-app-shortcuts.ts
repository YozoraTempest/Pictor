import { useEffect } from 'react'

import { KERNEL_VIEWS, kernelScopeOf } from './kernel-scope.js'
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
          // The open page decides the kernel, the same way its own 新聊天 does.
          void createSession(newSessionTitle(), null, kernelScopeOf(useUiStore.getState().view))
          return
        // The rail's accelerators, in its own order: home, then one per kernel.
        case '1':
          event.preventDefault()
          openView('home')
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
          // A kernel page's accelerator is derived, so adding a kernel to the rail
          // does not leave its number unbound.
          const index = Number(event.key) - 2
          const target = KERNEL_VIEWS[index]
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
