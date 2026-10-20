import { useEffect } from 'react'

import { Banner } from '../components/ui/index.js'
import { ChatView } from '../features/chat/ChatView.js'
import { useChatStore } from '../features/chat/chat-store.js'
import { SettingsView } from '../features/settings/SettingsView.js'
import { AppShell } from '../shell/AppShell.js'
import { useUiStore } from './ui-store.js'
import { useWorkspaceStore } from './workspace-store.js'

export function App(): React.JSX.Element {
  const view = useUiStore((state) => state.view)

  const refresh = useWorkspaceStore((state) => state.refresh)
  const error = useWorkspaceStore((state) => state.error)
  const notice = useWorkspaceStore((state) => state.notice)
  const setError = useWorkspaceStore((state) => state.setError)
  const setNotice = useWorkspaceStore((state) => state.setNotice)
  const selectedSessionId = useWorkspaceStore((state) => state.selectedSessionId)

  useEffect(() => {
    void refresh().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [refresh, setError])

  useEffect(() => window.pictor.onChatEvent(useChatStore.getState().handleEvent), [])

  useEffect(() => {
    void useChatStore.getState().open(selectedSessionId)
  }, [selectedSessionId])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1079px)')
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) useUiStore.setState({ rightPanelOpen: false })
    }

    narrow.addEventListener('change', onChange)
    return () => narrow.removeEventListener('change', onChange)
  }, [])

  const notification =
    error !== null ? (
      <Banner tone="error" onDismiss={() => setError(null)}>
        {error}
      </Banner>
    ) : notice !== null ? (
      <Banner tone="notice" onDismiss={() => setNotice(null)}>
        {notice}
      </Banner>
    ) : undefined

  return (
    <AppShell notification={notification}>
      {view === 'chat' ? <ChatView /> : <SettingsView />}
    </AppShell>
  )
}
